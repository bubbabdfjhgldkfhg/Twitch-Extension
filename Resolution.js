// ==UserScript==
// @name         Resolution
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      1.11
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
    const LOADING_CHECK_INTERVAL = 100; // Check very frequently when stream is loading
    const PAGE_CHANGE_WINDOW = 5000; // Monitor for 5 seconds after page change
    const DEBUG = true;
    let lastPageChange = 0;
    let videoPlayer = null;
    let loadingCheckTimer = null;
    let qualitySetForCurrentStream = false;

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
            log(`[${timeSincePageChange}ms] No player yet`);
            return false;
        }

        try {
            const qualities = videoPlayer.getQualities?.();
            const currentQuality = videoPlayer.getQuality?.();

            if (!qualities || qualities.length === 0) {
                log(`[${timeSincePageChange}ms] Player found, but no qualities available yet`);
                return false;
            }

            if (!currentQuality) {
                log(`[${timeSincePageChange}ms] Qualities available (${qualities.length}), but no current quality set yet`);
                return false;
            }

            // Log available qualities on first detection
            if (!qualitySetForCurrentStream) {
                const qualityList = qualities.map(q => `${q.name} (${q.height}p${q.framerate || '?'})`).join(', ');
                log(`[${timeSincePageChange}ms] Qualities detected: [${qualityList}]`);
                log(`[${timeSincePageChange}ms] Current quality: ${currentQuality.name} (${currentQuality.height}p${currentQuality.framerate || '?'})`);
            }

            const bestQuality = getBestQuality(qualities);
            if (!bestQuality) {
                log(`[${timeSincePageChange}ms] No best quality found (filtered: ${qualities.filter(q => q.group !== 'auto').length})`);
                return false;
            }

            if (isBestQuality(currentQuality, qualities)) {
                if (!qualitySetForCurrentStream) {
                    log(`[${timeSincePageChange}ms] Already at best: ${currentQuality.name} (${currentQuality.height}p${currentQuality.framerate})`);
                    qualitySetForCurrentStream = true;
                }
                return true;
            }

            // Only set quality if: forced, or if video is loading/buffering (not actively playing)
            const video = getVideoElement();
            const isLoading = isVideoLoading(video);
            const isPlaying = isVideoPlaying(video);
            const videoState = video ? `readyState=${video.readyState}, networkState=${video.networkState}, paused=${video.paused}` : 'no video element';

            log(`[${timeSincePageChange}ms] Video state: ${videoState}`);

            if (force || isLoading || !isPlaying) {
                log(`[${timeSincePageChange}ms] ✓ Switching: "${currentQuality.name}" → "${bestQuality.name}" (${bestQuality.height}p${bestQuality.framerate}) [loading: ${isLoading}, playing: ${isPlaying}]`);
                videoPlayer.setQuality(bestQuality);
                qualitySetForCurrentStream = true;
                return true;
            } else {
                log(`[${timeSincePageChange}ms] ✗ Delaying quality change - video is playing (will retry when buffering)`);
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
            log(`--- Check ${checkCount}/${Math.ceil(PAGE_CHANGE_WINDOW / LOADING_CHECK_INTERVAL)} ---`);
            const success = checkAndSetQuality();
            checksRemaining--;

            // Stop aggressive checking if we successfully set quality or time runs out
            if (success || checksRemaining <= 0) {
                clearInterval(loadingCheckTimer);
                loadingCheckTimer = null;
                log(`Stopped aggressive loading checks after ${checkCount} attempts (${success ? 'SUCCESS' : 'TIMEOUT'})`);
            }
        }, LOADING_CHECK_INTERVAL);

        log(`Started aggressive loading checks (every ${LOADING_CHECK_INTERVAL}ms for ${PAGE_CHANGE_WINDOW}ms)`);
    }

    function handlePageChange() {
        lastPageChange = Date.now();
        videoPlayer = null;
        qualitySetForCurrentStream = false;

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
