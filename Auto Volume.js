// ==UserScript==
// @name         Auto Volume
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      0.8
// @description  Analyze audio levels of a Twitch stream and automatically adjust volume
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/refs/heads/main/Auto%20Volume.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/refs/heads/main/Auto%20Volume.js
// @match        https://www.twitch.tv/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let audioContext;
    let analyser;
    let source;
    let levelDisplay;
    let rafId;
    let newPageCooldownActive;

    let newPageCooldownTimer = 2000;
    const SAMPLE_RATE = 50; // How many times per second to sample
    const SMALL_WINDOW = .1 * SAMPLE_RATE; // .5 seconds * samples per second
    const LARGE_WINDOW = 12 * SAMPLE_RATE;
    let small_samples = [];
    let large_samples = [];

    let lastVolumeAdjustment = 0;
    const VOLUME_DOWN_COOLDOWN = 110; // .11 seconds in milliseconds
    const VOLUME_UP_COOLDOWN = 210; // .21 seconds in milliseconds
    const MAX_DB_THRESHOLD = -12; // dBFS
    const MIN_DB_THRESHOLD = -25;
    const VOLUME_REDUCTION = -0.01; // 2%
    const VOLUME_INCREASE = 0.01;

    function initAudio() {
        const videoElement = document.querySelector('video');
        if (!videoElement) {
            console.error('No video element found');
            return;
        }

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;

        source = audioContext.createMediaElementSource(videoElement);
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        updateLevel();
    }

    function calculateDBFS(buffer) {
        const squareSum = buffer.reduce((sum, sample) => sum + sample * sample, 0);
        const rms = Math.sqrt(squareSum / buffer.length);
        return 20 * Math.log10(rms / 255); // Normalized to 0-255 range
    }

    function getReactInstance(element) {
        if (!element) return null;
        for (const key in element) {
            if (key.startsWith('__reactInternalInstance$') || key.startsWith('__reactFiber$')) {
                return element[key];
            }
        }
        return null;
    }

    function searchReactParents(node, predicate, maxDepth = 15, depth = 0) {
        try {
            if (predicate(node)) {
                return node;
            }
        } catch (_) {}

        if (!node || depth > maxDepth) {
            return null;
        }

        const {return: parent} = node;
        if (parent) {
            return searchReactParents(parent, predicate, maxDepth, depth + 1);
        }

        return null;
    }

    function getCurrentPlayer() {
        const PLAYER_SELECTOR = 'div[data-a-target="player-overlay-click-handler"], .video-player';
        try {
            const node = searchReactParents(
                getReactInstance(document.querySelector(PLAYER_SELECTOR)),
                n => n.memoizedProps?.mediaPlayerInstance?.core != null,
                30
            );
            return node?.memoizedProps.mediaPlayerInstance.core;
        } catch (e) {
            console.error("Failed to retrieve the player:", e);
        }
        return null;
    }

    function adjustVolume(volumeDelta) {
        const player = getCurrentPlayer();
        if (player) {
            const currentVolume = player.getVolume();
            const newVolume = Math.min(1, Math.max(0, currentVolume + volumeDelta));
            player.setVolume(newVolume);
            console.log(`Volume changed to ${newVolume.toFixed(2)}`);
        } else {
            console.warn("Player not found.");
        }
    }

    function updateLevel() {
        const array = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(array);

        const instantDB = calculateDBFS(array);

        // if (newPageCooldownActive) {
        //     console.log('newPageCooldownActive');
        // }

        if (instantDB && !isNaN(instantDB) && instantDB !== -Infinity && !newPageCooldownActive) {
            small_samples.push(instantDB);
            large_samples.push(instantDB);
        }

        if (small_samples.length > SMALL_WINDOW) {
            small_samples.shift(); // Remove oldest sample if we have more than 2 seconds worth
        }

        if (large_samples.length > LARGE_WINDOW) {
            large_samples.shift(); // Remove oldest sample if we have more than 2 seconds worth
        }

        const small_averageDB = small_samples.reduce((sum, value) => sum + value, 0) / small_samples.length;
        const large_averageDB = large_samples.reduce((sum, value) => sum + value, 0) / large_samples.length;
        // const minDB = Math.min(...samples);
        // const maxDB = Math.max(...samples);

        // Check if we need to lower the volume
        // if (Date.now() - lastVolumeAdjustment > VOLUME_DOWN_COOLDOWN) {
        if (instantDB > MAX_DB_THRESHOLD) {
            adjustVolume(VOLUME_REDUCTION);
            lastVolumeAdjustment = Date.now();
        }
        // }
        // if (Date.now() - lastVolumeAdjustment > 3000) {
        //     if (large_averageDB > -16) {
        //         adjustVolume(VOLUME_REDUCTION);
        //         lastVolumeAdjustment = Date.now();
        //     }
        // }
        // if (large_averageDB < MIN_DB_THRESHOLD && small_averageDB < MIN_DB_THRESHOLD
        //     && Date.now() - lastVolumeAdjustment > VOLUME_UP_COOLDOWN) {
        //     adjustVolume(VOLUME_INCREASE);
        //     lastVolumeAdjustment = Date.now();
        // }

        //         levelDisplay.textContent = `Instant Level: ${instantDB.toFixed(2)} dBFS
        // Avg: ${averageDB.toFixed(2)} dBFS
        // Max: ${maxDB.toFixed(2)} dBFS`;

        // levelDisplay.textContent = `.1s Avg: ${small_averageDB.toFixed(0)} dBFS 5s Avg: ${large_averageDB.toFixed(1)} dBFS`;

        rafId = setTimeout(() => {
            requestAnimationFrame(updateLevel);
        }, 1000 / SAMPLE_RATE);
    }

    function handlePathChange() {
        newPageCooldownActive = true;
        setTimeout(() => {
            newPageCooldownActive = false;
            console.log('turned off newPageCooldownActive');
        }, newPageCooldownTimer);

        small_samples = [];
        large_samples = [];
    }

    function createLevelDisplay() {
        levelDisplay = document.createElement('div');
        levelDisplay.style.position = 'fixed';
        levelDisplay.style.top = '10px';
        levelDisplay.style.right = '10px';
        levelDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        levelDisplay.style.color = 'white';
        levelDisplay.style.padding = '10px';
        levelDisplay.style.borderRadius = '5px';
        levelDisplay.style.zIndex = '9999';
        levelDisplay.style.fontFamily = 'monospace';
        levelDisplay.style.lineHeight = '1.5';
        document.body.appendChild(levelDisplay);
    }

    function init() {
        // createLevelDisplay();

        // Wait for the video element to be added to the DOM
        const observer = new MutationObserver((mutations) => {
            if (document.querySelector('video')) {
                observer.disconnect();
                initAudio();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Run the init function when the page is fully loaded
    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

    (function(history){
        const overrideHistoryMethod = (methodName) => {
            const original = history[methodName];
            history[methodName] = function(state) {
                const result = original.apply(this, arguments);
                setTimeout(handlePathChange, 0); // Timeout needed for window.location.pathname to update
                return result;
            };
        };
        overrideHistoryMethod('pushState');
        overrideHistoryMethod('replaceState');
    })(window.history);
    window.addEventListener('popstate', handlePathChange);
})();
