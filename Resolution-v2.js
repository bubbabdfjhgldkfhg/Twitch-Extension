// ==UserScript==
// @name         Resolution-v2
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      2.0
// @description  Auto-select highest quality using ABR configuration instead of manual switching
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Resolution-v2.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Resolution-v2.js
// @match        *://*.twitch.tv/*
// @exclude      *://*.twitch.tv/videos/*
// @exclude      *://*.twitch.tv/*/clip/*
// @grant        none
// ==/UserScript==

// =============================================================================
// RESOLUTION V2 - ABR-BASED QUALITY CONTROL
// =============================================================================
//
// Instead of manually calling setQuality() (which causes rebuffering), this
// version configures the ABR (Adaptive Bitrate) system to always select the
// highest available quality.
//
// Methods used:
// - setAutoQualityMode(true)      : Enable ABR
// - setAutoInitialBitrate(bitrate): Start at highest bitrate
// - setAutoMaxBitrate(bitrate)    : Don't cap the max (set very high)
// - setAutoMaxQuality(quality)    : Set max to best available quality
//
// This should provide smoother quality selection without manual rebuffering.
// =============================================================================

(function() {
    'use strict';

    const DEBUG = true;
    const CHECK_INTERVAL = 2000;
    const SETUP_RETRY_INTERVAL = 100;
    const SETUP_TIMEOUT = 10000;

    let videoPlayer = null;
    let configured = false;
    let lastPath = null;
    let setupStartTime = null;

    function log(...args) {
        console.log('[Resolution-v2]', ...args);
    }

    function findReactNode(root, constraint) {
        if (root.stateNode && constraint(root.stateNode)) return root.stateNode;
        let node = root.child;
        while (node) {
            const result = findReactNode(node, constraint);
            if (result) return result;
            node = node.sibling;
        }
        return null;
    }

    function findReactRootNode() {
        let rootNode = document.querySelector('#root');
        let reactRootNode = rootNode?._reactRootContainer?._internalRoot?.current;
        if (!reactRootNode) {
            let containerName = Object.keys(rootNode).find(x => x.startsWith('__reactContainer'));
            if (containerName) reactRootNode = rootNode[containerName];
        }
        return reactRootNode;
    }

    function getPlayer() {
        try {
            return findReactNode(findReactRootNode(), node =>
                node.setPlayerActive && node.props && node.props.mediaPlayerInstance
            )?.props.mediaPlayerInstance;
        } catch (e) {
            return null;
        }
    }

    function getBestQuality(qualities) {
        if (!qualities || !qualities.length) return null;
        return [...qualities]
            .filter(q => q.group !== 'auto')
            .sort((a, b) => {
                if ((b.height || 0) !== (a.height || 0)) return (b.height || 0) - (a.height || 0);
                if ((b.framerate || 0) !== (a.framerate || 0)) return (b.framerate || 0) - (a.framerate || 0);
                return (b.bitrate || 0) - (a.bitrate || 0);
            })[0] || null;
    }

    function formatBitrate(bps) {
        if (bps >= 1000000) return `${(bps / 1000000).toFixed(1)} Mbps`;
        if (bps >= 1000) return `${(bps / 1000).toFixed(0)} Kbps`;
        return `${bps} bps`;
    }

    function configureABR() {
        videoPlayer = getPlayer();
        if (!videoPlayer) {
            return false;
        }

        const qualities = videoPlayer.getQualities?.();
        if (!qualities || qualities.length === 0) {
            return false;
        }

        const bestQuality = getBestQuality(qualities);
        if (!bestQuality) {
            return false;
        }

        const currentQuality = videoPlayer.getQuality?.();
        const isAutoMode = videoPlayer.isAutoQualityMode?.();
        const currentBitrate = videoPlayer.getVideoBitRate?.();
        const bandwidthEstimate = videoPlayer.getBandwidthEstimate?.();

        log('=== Current State ===');
        log(`Quality: ${currentQuality?.name || 'unknown'} (${currentQuality?.height}p${currentQuality?.framerate})`);
        log(`Auto mode: ${isAutoMode}`);
        log(`Current bitrate: ${formatBitrate(currentBitrate)}`);
        log(`Bandwidth estimate: ${formatBitrate(bandwidthEstimate)}`);
        log(`Available qualities:`, qualities.map(q => `${q.name} (${formatBitrate(q.bitrate)})`).join(', '));
        log(`Best quality: ${bestQuality.name} (${formatBitrate(bestQuality.bitrate)})`);

        log('=== Configuring ABR ===');

        // Method 1: Set initial bitrate to highest available
        // This tells ABR to START at the highest quality
        try {
            const highestBitrate = bestQuality.bitrate;
            log(`Setting initial bitrate to ${formatBitrate(highestBitrate)}`);
            videoPlayer.setAutoInitialBitrate(highestBitrate);
        } catch (e) {
            log('setAutoInitialBitrate failed:', e.message);
        }

        // Method 2: Set max bitrate very high (don't cap)
        // This tells ABR it can go as high as it wants
        try {
            const uncappedBitrate = 100000000; // 100 Mbps - effectively uncapped
            log(`Setting max bitrate to ${formatBitrate(uncappedBitrate)} (uncapped)`);
            videoPlayer.setAutoMaxBitrate(uncappedBitrate);
        } catch (e) {
            log('setAutoMaxBitrate failed:', e.message);
        }

        // Method 3: Set max quality to the best available
        try {
            log(`Setting max quality to ${bestQuality.name}`);
            videoPlayer.setAutoMaxQuality(bestQuality);
        } catch (e) {
            log('setAutoMaxQuality failed:', e.message);
        }

        // Method 4: Set max video size to best resolution
        try {
            log(`Setting max video size to ${bestQuality.width}x${bestQuality.height}`);
            videoPlayer.setAutoMaxVideoSize(bestQuality.width, bestQuality.height);
        } catch (e) {
            log('setAutoMaxVideoSize failed:', e.message);
        }

        // Method 5: Ensure ABR is enabled
        try {
            log(`Enabling auto quality mode`);
            videoPlayer.setAutoQualityMode(true);
        } catch (e) {
            log('setAutoQualityMode failed:', e.message);
        }

        log('=== ABR Configuration Complete ===');

        // Schedule a check to see if it worked
        setTimeout(() => {
            const newQuality = videoPlayer?.getQuality?.();
            const newIsAutoMode = videoPlayer?.isAutoQualityMode?.();
            const newBitrate = videoPlayer?.getVideoBitRate?.();

            log('=== Post-Configuration State (after 2s) ===');
            log(`Quality: ${newQuality?.name || 'unknown'} (${newQuality?.height}p${newQuality?.framerate})`);
            log(`Auto mode: ${newIsAutoMode}`);
            log(`Current bitrate: ${formatBitrate(newBitrate)}`);

            if (newQuality?.group === bestQuality.group) {
                log('✓ Successfully at best quality!');
            } else {
                log(`✗ Not at best quality. Expected: ${bestQuality.name}, Got: ${newQuality?.name}`);
                log('Falling back to manual setQuality...');
                try {
                    videoPlayer.setQuality(bestQuality);
                    log(`Manual setQuality called for ${bestQuality.name}`);
                } catch (e) {
                    log('Manual setQuality failed:', e.message);
                }
            }
        }, 2000);

        // Schedule another check at 5s
        setTimeout(() => {
            const finalQuality = videoPlayer?.getQuality?.();
            log(`=== Final State (after 5s) ===`);
            log(`Quality: ${finalQuality?.name || 'unknown'}`);
            if (finalQuality?.group === bestQuality.group) {
                log('✓ At best quality');
            } else {
                log(`✗ Still not at best quality: ${finalQuality?.name}`);
            }
        }, 5000);

        return true;
    }

    function trySetup() {
        if (configured) return;

        const elapsed = Date.now() - setupStartTime;
        if (elapsed > SETUP_TIMEOUT) {
            log(`Setup timeout after ${elapsed}ms`);
            return;
        }

        if (configureABR()) {
            configured = true;
            log(`ABR configured after ${elapsed}ms`);
        } else {
            setTimeout(trySetup, SETUP_RETRY_INTERVAL);
        }
    }

    function handlePageChange() {
        const currentPath = window.location.pathname;
        if (currentPath === lastPath) return;

        lastPath = currentPath;
        videoPlayer = null;
        configured = false;
        setupStartTime = Date.now();

        log(`Page change detected: ${currentPath}`);
        trySetup();
    }

    // Monitor for quality changes
    function monitorQuality() {
        if (!videoPlayer) {
            videoPlayer = getPlayer();
            return;
        }

        const qualities = videoPlayer.getQualities?.();
        const currentQuality = videoPlayer.getQuality?.();
        const bestQuality = getBestQuality(qualities);

        if (bestQuality && currentQuality && currentQuality.group !== bestQuality.group) {
            log(`Quality drift detected: ${currentQuality.name} (best: ${bestQuality.name})`);
            // Optionally re-configure ABR
            // configureABR();
        }
    }

    log('Script loaded - ABR-based quality control');

    // Initial setup
    handlePageChange();

    // Periodic monitoring
    setInterval(monitorQuality, CHECK_INTERVAL);

    // Handle navigation
    (function(history) {
        const override = (method) => {
            const original = history[method];
            history[method] = function(state) {
                const result = original.apply(this, arguments);
                handlePageChange();
                return result;
            };
        };
        override('pushState');
        override('replaceState');
    })(window.history);

    window.addEventListener('popstate', handlePageChange);
})();
