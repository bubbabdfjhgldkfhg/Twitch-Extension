// ==UserScript==
// @name         Resolution
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      1.8
// @description  Automatically sets Twitch streams to source/max quality
// @match        *://*.twitch.tv/*
// @exclude      *://*.twitch.tv/videos/*
// @exclude      *://*.twitch.tv/*/clip/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    const CHECK_INTERVAL = 3000;
    const PAGE_CHANGE_COOLDOWN = 3000;
    const DEBUG = true;
    let lastPageChange = 0;
    let videoPlayer = null;

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

    function checkAndSetQuality() {
        const cooldownRemaining = PAGE_CHANGE_COOLDOWN - (Date.now() - lastPageChange);
        if (cooldownRemaining > 0) return;

        videoPlayer = videoPlayer || getPlayer();
        if (!videoPlayer) return;

        try {
            const qualities = videoPlayer.getQualities?.();
            const currentQuality = videoPlayer.getQuality?.();

            if (!qualities || !currentQuality) return;

            const bestQuality = getBestQuality(qualities);
            if (!bestQuality) return;

            if (isBestQuality(currentQuality, qualities)) {
                // log(`Already at best: ${currentQuality.name} (${currentQuality.height}p${currentQuality.framerate})`);
                return;
            }

            log(`Switching: "${currentQuality.name}" → "${bestQuality.name}" (${bestQuality.height}p${bestQuality.framerate})`);
            videoPlayer.setQuality(bestQuality);
        } catch (e) {
            log('Error:', e);
        }
    }

    function handlePageChange() {
        lastPageChange = Date.now();
        videoPlayer = null;
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
