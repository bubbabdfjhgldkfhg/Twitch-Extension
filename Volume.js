// ==UserScript==
// @name         Volume
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      1.4
// @description  Remember and restore per-channel volume settings
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Volume.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Volume.js
// @match        *://*.twitch.tv/*
// @exclude      *://*.twitch.tv/videos/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG_MODE = false;
    function debug(...args) {
        if (DEBUG_MODE) {
            const now = new Date();
            const timestamp = now.toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                fractionalSecondDigits: 3
            });
            console.log(`[Volume Debug ${timestamp}]:`, ...args);
        }
    }

    let defaultVolume = 0.5;
    debug('Script initialized with default volume:', defaultVolume);

    let observer;
    let isAdjustingVolume = false; // Flag to prevent detecting our own updates

    // Function to get the React internal instance from a DOM element
    function getReactInstance(element) {
        if (!element) {
            debug('getReactInstance: Element is null');
            return null;
        }
        for (const key in element) {
            if (key.startsWith('__reactInternalInstance$') || key.startsWith('__reactFiber$')) {
                debug('Found React instance with key:', key);
                return element[key];
            }
        }
        debug('No React instance found for element');
        return null;
    }

    // Function to search React parent components up to a maximum depth
    function searchReactParents(node, predicate, maxDepth = 15, depth = 0) {
        try {
            if (predicate(node)) {
                debug('Found matching React parent node');
                return node;
            }
        } catch (e) {
            debug('Error in predicate function:', e);
        }

        if (!node || depth > maxDepth) {
            debug('Search terminated - reached null node or max depth');
            return null;
        }

        const {return: parent} = node;
        if (parent) {
            return searchReactParents(parent, predicate, maxDepth, depth + 1);
        }

        debug('No parent node found');
        return null;
    }

    // Function to get the current player from Twitch's embedded player on the page
    function getCurrentPlayer() {
        debug('Attempting to get current player');
        const PLAYER_SELECTOR = 'div[data-a-target="player-overlay-click-handler"], .video-player';
        try {
            const playerElement = document.querySelector(PLAYER_SELECTOR);
            debug('Found player element:', !!playerElement);

            // First try the new structure (mediaPlayerInstance directly has methods)
            let node = searchReactParents(
                getReactInstance(playerElement),
                n => n.memoizedProps?.mediaPlayerInstance?.getVolume != null,
                50
            );

            if (node?.memoizedProps?.mediaPlayerInstance) {
                debug('Successfully retrieved player instance (new structure)');
                return node.memoizedProps.mediaPlayerInstance;
            }

            // Fallback to old structure (mediaPlayerInstance.core)
            node = searchReactParents(
                getReactInstance(playerElement),
                n => n.memoizedProps?.mediaPlayerInstance?.core != null,
                50
            );

            if (node?.memoizedProps?.mediaPlayerInstance?.core) {
                debug('Successfully retrieved player instance (old structure)');
                return node.memoizedProps.mediaPlayerInstance.core;
            }

            debug('Player instance not found in React tree');
            return null;
        } catch (e) {
            debug('Error getting current player:', e);
        }
        return null;
    }

    // Function to adjust the volume
    function adjustVolume(targetVolume) {
        debug('Adjusting volume to:', targetVolume);
        const player = getCurrentPlayer();
        if (player) {
            let currentVolume = player.getVolume();
            currentVolume = parseFloat(currentVolume.toFixed(2));
            debug('Current volume:', currentVolume);
            if (currentVolume != targetVolume) {
                isAdjustingVolume = true;
                debug('Setting new volume', targetVolume);
                player.setVolume(targetVolume);
                // Set global volume so the page doesnt get confused
                localStorage.setItem('volume', targetVolume);
                debug('Volume saved to localStorage');
                setTimeout(() => {
                    isAdjustingVolume = false;
                }, 150);
            } else {
                debug('Volume already at target level');
            }
        } else {
            debug('Warning: Player not found for volume adjustment');
        }
    }

    // Purge expired or legacy volume settings (runs once on page load)
    const VOLUME_EXPIRY_DAYS = 30;
    (function purgeExpiredSettings() {
        const now = Date.now();
        const maxAge = VOLUME_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key.startsWith('volumeSetting')) continue;
            const raw = localStorage.getItem(key);
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && parsed.timestamp) {
                    if (now - parsed.timestamp > maxAge) {
                        keysToRemove.push(key);
                        debug('Purging expired setting:', key);
                    }
                    continue;
                }
            } catch (e) {}
            // Not valid JSON or missing timestamp — legacy entry, remove it
            keysToRemove.push(key);
            debug('Purging legacy setting:', key);
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        debug('Purged', keysToRemove.length, 'expired/legacy volume settings');
    })();

    // Local storage handling for volume settings
    function saveVolume(slider, pathname) {
        if (pathname == '/') return;

        const volume = parseFloat(slider.value);
        debug('Saving volume for path:', pathname, 'Volume:', volume);
        if (volume != defaultVolume) {
            localStorage.setItem('volumeSetting' + pathname, JSON.stringify({
                volume: volume,
                timestamp: Date.now()
            }));
            debug('Volume saved to localStorage');
        }
    }

    function loadVolume(pathname) {
        debug('Loading volume for path:', pathname);
        const raw = localStorage.getItem('volumeSetting' + pathname);
        if (!raw) return defaultVolume;
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && parsed.volume !== undefined) {
                debug('Loaded volume:', parsed.volume);
                return parsed.volume;
            }
        } catch (e) {}
        // Legacy plain number format — still usable until purged
        const volume = parseFloat(raw);
        debug('Loaded legacy volume:', volume);
        return isNaN(volume) ? defaultVolume : volume;
    }

    function handlePathChange() {
        debug('Running handlePathChange in 300ms');
        // Added a delay to see if it helps w/ crashes
        // Without the delay, this might try to adjust volume before the player loads
        setTimeout(() => {
            const pathname = window.location.pathname;
            debug('Handling path change for:', pathname);
            adjustVolume(loadVolume(pathname));
        }, 300);
    }

    // Observe changes in the volume slider to save the volume
    function sliderObserver(slider) {
        debug('Setting up slider observer');
        const config = { attributes: true, childList: false, subtree: false };
        observer = new MutationObserver((mutations) => {
            if (isAdjustingVolume) {
                debug('Ignoring mutation - volume is being adjusted programmatically');
                return;
            }
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'value') {
                    debug('Slider value changed by user');
                    saveVolume(slider, window.location.pathname);
                }
            });
        });
        observer.observe(slider, config);
        debug('Slider observer set up successfully');
        return observer;
    }

    setInterval(function() {
        let slider = document.querySelector('[data-a-target="player-volume-slider"]')
        if (slider && observer?.targetElement != slider) {
            debug('New slider element detected');
            debug('Calling handlePathChange');
            handlePathChange();
            observer?.disconnect();
            debug('Previous observer disconnected');
            observer = sliderObserver(slider);
            observer.targetElement = slider;
            debug('New observer connected to slider');
        }
    }, 100);

    // Enhance navigation handling by overriding history methods
    (function(history){
        debug('Setting up history method overrides');
        const overrideHistoryMethod = (methodName) => {
            const original = history[methodName];
            history[methodName] = function(state) {
                debug(`History ${methodName} called`);
                const result = original.apply(this, arguments);
                setTimeout(handlePathChange, 0); // Timeout needed for window.location.pathname to update
                return result;
            };
        };
        overrideHistoryMethod('pushState');
        overrideHistoryMethod('replaceState');
        debug('History method overrides completed');
    })(window.history);

    window.addEventListener('popstate', () => {
        debug('Popstate event detected');
        handlePathChange();
    });

    debug('Script setup completed');
})();
