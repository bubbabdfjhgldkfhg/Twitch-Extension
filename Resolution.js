// ==UserScript==
// @name         Resolution
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      1.9
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
    const LOADING_CHECK_INTERVAL = 500; // Check frequently when stream is loading
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
        videoPlayer = videoPlayer || getPlayer();
        if (!videoPlayer) return false;

        try {
            const qualities = videoPlayer.getQualities?.();
            const currentQuality = videoPlayer.getQuality?.();

            if (!qualities || !currentQuality) return false;

            const bestQuality = getBestQuality(qualities);
            if (!bestQuality) return false;

            if (isBestQuality(currentQuality, qualities)) {
                if (!qualitySetForCurrentStream) {
                    log(`Already at best: ${currentQuality.name} (${currentQuality.height}p${currentQuality.framerate})`);
                    qualitySetForCurrentStream = true;
                }
                return true;
            }

            // Only set quality if: forced, or if video is loading/buffering (not actively playing)
            const video = getVideoElement();
            const isLoading = isVideoLoading(video);
            const isPlaying = isVideoPlaying(video);

            if (force || isLoading || !isPlaying) {
                log(`Switching: "${currentQuality.name}" → "${bestQuality.name}" (${bestQuality.height}p${bestQuality.framerate}) [loading: ${isLoading}, playing: ${isPlaying}]`);
                videoPlayer.setQuality(bestQuality);
                qualitySetForCurrentStream = true;
                return true;
            } else {
                log(`Delaying quality change - video is playing (will retry when buffering)`);
                return false;
            }
        } catch (e) {
            log('Error:', e);
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
        loadingCheckTimer = setInterval(() => {
            const success = checkAndSetQuality();
            checksRemaining--;

            // Stop aggressive checking if we successfully set quality or time runs out
            if (success || checksRemaining <= 0) {
                clearInterval(loadingCheckTimer);
                loadingCheckTimer = null;
                log('Stopped aggressive loading checks');
            }
        }, LOADING_CHECK_INTERVAL);

        log('Started aggressive loading checks');
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
