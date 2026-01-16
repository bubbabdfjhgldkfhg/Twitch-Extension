// ==UserScript==
// @name         Resolution
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      2.0
// @description  Automatically sets Twitch streams to source/max quality
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Resolution.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Resolution.js
// @match        *://*.twitch.tv/*
// @exclude      *://*.twitch.tv/videos/*
// @exclude      *://*.twitch.tv/*/clip/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    const CHECK_INTERVAL = 10000; // Check every 10 seconds during normal operation
    const LOADING_CHECK_INTERVAL = 150; // Check frequently when stream is loading
    const PAGE_CHANGE_WINDOW = 5000; // Monitor for 5 seconds after page change
    const EARLY_EXIT_AFTER_STABLE_CHECKS = 10; // Exit early after this many stable checks (~1.5s)
    const DEBUG = false;
    let lastPageChange = 0;
    let videoPlayer = null;
    let loadingCheckTimer = null;
    let qualitySetForCurrentStream = false;
    let lastSeenQualityCount = 0;
    let bestQualityHeight = 0;
    let consecutiveStableChecks = 0;
    let lastSetQualityGroup = null;

    function log(...args) {
        if (DEBUG) console.log('[Force Source]', ...args);
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
        let reactRootNode = null;
        let rootNode = document.querySelector('#root');
        reactRootNode = rootNode?._reactRootContainer?._internalRoot?.current;
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
        // Filter out auto, sort by: height > framerate > bitrate
        return [...qualities]
            .filter(q => q.group !== 'auto')
            .sort((a, b) => {
                if ((b.height || 0) !== (a.height || 0)) return (b.height || 0) - (a.height || 0);
                if ((b.framerate || 0) !== (a.framerate || 0)) return (b.framerate || 0) - (a.framerate || 0);
                return (b.bitrate || 0) - (a.bitrate || 0);
            })[0] || null;
    }

    function isBestQuality(current, qualities) {
        if (!current || !qualities) return false;
        const best = getBestQuality(qualities);
        if (!best) return false;
        return current.group === best.group;
    }

    function getVideoElement() {
        return document.querySelector('video');
    }

    function isVideoLoading(video) {
        if (!video) return false;
        // Video is loading if: readyState < 3 (HAVE_FUTURE_DATA) or it's explicitly in a loading state
        return video.readyState < 3 || video.networkState === 2;
    }

    function isVideoPlaying(video) {
        if (!video) return false;
        return !video.paused && !video.ended && video.readyState > 2;
    }

    function checkAndSetQuality(force = false) {
        const timeSincePageChange = Date.now() - lastPageChange;

        videoPlayer = videoPlayer || getPlayer();
        if (!videoPlayer) {
            return false;
        }

        try {
            const qualities = videoPlayer.getQualities?.();
            const currentQuality = videoPlayer.getQuality?.();

            if (!qualities || qualities.length === 0) {
                return false;
            }

            if (!currentQuality) {
                return false;
            }

            const bestQuality = getBestQuality(qualities);
            if (!bestQuality) {
                log(`[${timeSincePageChange}ms] No best quality found (filtered: ${qualities.filter(q => q.group !== 'auto').length})`);
                return false;
            }

            // Check if quality list has expanded (new transcodes available)
            const qualityCountChanged = qualities.length !== lastSeenQualityCount;
            const betterQualityAvailable = bestQuality.height > bestQualityHeight;

            if (qualityCountChanged || betterQualityAvailable) {
                const qualityList = qualities.map(q => `${q.name} (${q.height}p${q.framerate || '?'})`).join(', ');
                log(`[${timeSincePageChange}ms] ${qualityCountChanged ? 'NEW' : 'BETTER'} qualities: [${qualityList}]`);
                lastSeenQualityCount = qualities.length;
                bestQualityHeight = bestQuality.height;
                consecutiveStableChecks = 0; // Reset stability counter when quality list changes
            }

            if (isBestQuality(currentQuality, qualities)) {
                consecutiveStableChecks++;
                if (!qualitySetForCurrentStream || qualityCountChanged || betterQualityAvailable) {
                    log(`[${timeSincePageChange}ms] ✓ At best: ${currentQuality.name} (${currentQuality.height}p${currentQuality.framerate})`);
                    qualitySetForCurrentStream = true;
                }
                // Early exit if stable for long enough
                if (consecutiveStableChecks >= EARLY_EXIT_AFTER_STABLE_CHECKS) {
                    return 'stop'; // Signal to stop checking
                }
                return false; // Keep checking but don't stop yet
            }

            // Reset stability counter when we need to switch
            consecutiveStableChecks = 0;

            // Prevent duplicate setQuality calls
            if (bestQuality.group === lastSetQualityGroup) {
                return false;
            }

            // Need to switch quality - only do it if video is loading or not playing
            const video = getVideoElement();
            const isLoading = isVideoLoading(video);
            const isPlaying = isVideoPlaying(video);

            if (force || isLoading || !isPlaying) {
                log(`[${timeSincePageChange}ms] ✓ Switching: "${currentQuality.name}" → "${bestQuality.name}" (${bestQuality.height}p${bestQuality.framerate})`);
                videoPlayer.setQuality(bestQuality);
                lastSetQualityGroup = bestQuality.group;
                qualitySetForCurrentStream = true;
                return false; // Keep checking in case better qualities appear
            } else {
                log(`[${timeSincePageChange}ms] ⏸ Waiting (video playing)`);
                return false;
            }
        } catch (e) {
            log(`[${timeSincePageChange}ms] Error:`, e);
            return false;
        }
    }

    function startLoadingChecks() {
        // Clear any existing loading check timer
        if (loadingCheckTimer) {
            clearInterval(loadingCheckTimer);
        }

        // Aggressively check during the page change window
        let checksRemaining = PAGE_CHANGE_WINDOW / LOADING_CHECK_INTERVAL;
        let checkCount = 0;
        loadingCheckTimer = setInterval(() => {
            checkCount++;
            const result = checkAndSetQuality();
            checksRemaining--;

            // Stop if: quality is stable for long enough, or time runs out
            if (result === 'stop' || checksRemaining <= 0) {
                clearInterval(loadingCheckTimer);
                loadingCheckTimer = null;
                if (result === 'stop') {
                    log(`Quality stable after ${checkCount} checks (${checkCount * LOADING_CHECK_INTERVAL}ms)`);
                }
            }
        }, LOADING_CHECK_INTERVAL);

        log(`Monitoring quality (${LOADING_CHECK_INTERVAL}ms intervals, max ${PAGE_CHANGE_WINDOW}ms)`);
    }

    function handlePageChange() {
        lastPageChange = Date.now();
        videoPlayer = null;
        qualitySetForCurrentStream = false;
        lastSeenQualityCount = 0;
        bestQualityHeight = 0;
        consecutiveStableChecks = 0;
        lastSetQualityGroup = null;

        // Start aggressive checking to catch the stream as it loads
        startLoadingChecks();
    }

    log('Script loaded');
    setInterval(checkAndSetQuality, CHECK_INTERVAL);

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
