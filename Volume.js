// ==UserScript==
// @name         Volume
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      0.9
// @description  Automatically set channel specific volume on Twitch
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Volume.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Volume.js
// @match        *://*.twitch.tv/*
// @exclude      *://*.twitch.tv/videos/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const defaultVolume = 0.5;

    let observer;
    let checkSliderInterval;
    let isAdjustingVolume = false; // Flag to prevent detecting our own updates

    // Function to get the React internal instance from a DOM element
    function getReactInstance(element) {
        if (!element) return null;
        for (const key in element) {
            if (key.startsWith('__reactInternalInstance$') || key.startsWith('__reactFiber$')) {
                return element[key];
            }
        }
        return null;
    }

    // Function to search React parent components up to a maximum depth
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

    // Function to get the current player from Twitch's embedded player on the page
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

    // Function to adjust the volume
    function adjustVolume(targetVolume) {
        // Assign to global
        const player = getCurrentPlayer();
        if (player) {
            let currentVolume = player.getVolume();
            if (currentVolume != targetVolume) {
                isAdjustingVolume = true;
                player.setVolume(targetVolume);
                // Set global volume so the page doesnt get confused
                localStorage.setItem('volume', targetVolume);
                isAdjustingVolume = false;
            }
        } else {
            console.warn("Player not found.");
        }
    }

    // Local storage handling for volume settings
    function saveVolume(slider, pathname) {
        const volume = parseFloat(slider.value);
        if (volume != defaultVolume) {
            localStorage.setItem('volumeSetting' + pathname, volume);
        }
    }

    function loadVolume(pathname) {
        const savedVolume = localStorage.getItem('volumeSetting' + pathname);
        return savedVolume ? parseFloat(savedVolume) : defaultVolume;
    }

    function handlePathChange() {
        // Added a delay to see if it helps w/ crashes
        setTimeout(() => {
            adjustVolume(loadVolume(window.location.pathname));
        }, 300);
    }

    // Observe changes in the volume slider to save the volume
    function sliderObserver(slider) {
        const config = { attributes: true, childList: false, subtree: false };
        observer = new MutationObserver((mutations) => {
            if (isAdjustingVolume) return;
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'value') {
                    saveVolume(slider, window.location.pathname);
                }
            });
        });
        observer.observe(slider, config);
        return observer;
    }

    setInterval(function() {
        let slider = document.querySelector('[data-a-target="player-volume-slider"]')
        if (slider && observer?.targetElement != slider) {
            handlePathChange();
            observer?.disconnect();
            observer = sliderObserver(slider);
            observer.targetElement = slider;
        }
    }, 100);

    // Enhance navigation handling by overriding history methods. Adds a call to handlePathChange.
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
