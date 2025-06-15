// ==UserScript==
// @name         Shuffle
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      2.3
// @description  Adds a shuffle button to the Twitch video player
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Shuffle.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Shuffle.js
// @match        *://*.twitch.tv/*
// @exclude      *://*.twitch.tv/videos/*
// @grant        none
// ==/UserScript==

// https://icons.getbootstrap.com/

// Define SVG paths for buttons
const heartFill = "M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314z";
const heartHalfFill = "M8 2.748v11.047c3.452-2.368 5.365-4.542 6.286-6.357.955-1.886.838-3.362.314-4.385C13.486.878 10.4.28 8.717 2.01L8 2.748zM8 15C-7.333 4.868 3.279-3.04 7.824 1.143c.06.055.119.112.176.171a3.12 3.12 0 0 1 .176-.17C12.72-3.042 23.333 4.867 8 15z";
const heartNoFill = "m8 2.748-.717-.737C5.6.281 2.514.878 1.4 3.053c-.523 1.023-.641 2.5.314 4.385.92 1.815 2.834 3.989 6.286 6.357 3.452-2.368 5.365-4.542 6.286-6.357.955-1.886.838-3.362.314-4.385C13.486.878 10.4.28 8.717 2.01L8 2.748zM8 15C-7.333 4.868 3.279-3.04 7.824 1.143c.06.055.119.112.176.171a3.12 3.12 0 0 1 .176-.17C12.72-3.042 23.333 4.867 8 15z";

const heartbreakFill = "M8.931.586 7 3l1.5 4-2 3L8 15C22.534 5.396 13.757-2.21 8.931.586M7.358.77 5.5 3 7 7l-1.5 3 1.815 4.537C-6.533 4.96 2.685-2.467 7.358.77";
const heartbreak = "M8.867 14.41c13.308-9.322 4.79-16.563.064-13.824L7 3l1.5 4-2 3L8 15a38 38 0 0 0 .867-.59m-.303-1.01-.971-3.237 1.74-2.608a1 1 0 0 0 .103-.906l-1.3-3.468 1.45-1.813c1.861-.948 4.446.002 5.197 2.11.691 1.94-.055 5.521-6.219 9.922m-1.25 1.137a36 36 0 0 1-1.522-1.116C-5.077 4.97 1.842-1.472 6.454.293c.314.12.618.279.904.477L5.5 3 7 7l-1.5 3zm-2.3-3.06-.442-1.106a1 1 0 0 1 .034-.818l1.305-2.61L4.564 3.35a1 1 0 0 1 .168-.991l1.032-1.24c-1.688-.449-3.7.398-4.456 2.128-.711 1.627-.413 4.55 3.706 8.229Z";

const continuousShuffle1 = "M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z";
const continuousShuffle2 = "M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z";


const svgPaths = {
    followed: { path1: heartFill, path2: null },
    recommended: { path1: heartHalfFill, path2: null },
    discover: { path1: heartNoFill, path2: null },
    continuous: { path1: continuousShuffle1, path2: continuousShuffle2 }
};

(function() {
    'use strict';

    // Add rotation keyframes for the continuous button
    const style = document.createElement('style');
    style.textContent = `@keyframes shuffleRotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
    document.head.appendChild(style);

    // ===========================
    //          CONFIG
    // ===========================

    let shuffleType = 'followed'; // Default (the options are ['followed', 'recommended', 'discover'])

    // The channel timer determines how long to stay on each channel in continuous shuffle mode (1000 * seconds = milliseconds)
    let followedChannelTimer = 1000 * 25;
    let recommendedChannelTimer = 1000 * 20;
    let discoverChannelTimer = 1000 * 7;
    let rotationTimer = followedChannelTimer; // Default (keep this the same as the shuffle type, the options are above.)

    let newChannelCooldownTimer = 1000 * 2.6; // Minimum delay between channel clicks. Things break if you go too fast.
    let maxSimilarChannelClicks = 15; // How many channels deep to go in 'discover' mode.

    // ===========================
    //        END CONFIG
    // ===========================

    let autoRotateEnabled = false;
    let observer = null;
    let lastClickedHrefs = [];
    let snoozedList = [];
    let cooldownActive = false;
    let coolDownTimerId;
    let rotationTimerId = null;
    let similarChannelClickCount = 0;

    function getSnoozePaths() {
        switch (shuffleType) {
            case 'followed':
                return { path1: heartbreakFill, path2: null };
            case 'recommended':
                return { path1: heartbreakFill, path2: heartbreak, clip: 'left' };
            case 'discover':
            default:
                return { path1: heartbreak, path2: null };
        }
    }

    function updateFollowToggleIcon() {
        const toggleButton = document.querySelector('button[data-a-target="player-follow-toggle-button"]');
        if (!toggleButton) return;
        let paths = toggleButton.querySelectorAll('path');
        const isSnoozed = snoozedList.includes(window.location.pathname);
        const icon = isSnoozed ? getSnoozePaths() : svgPaths[shuffleType];
        const color = isSnoozed ? 'red' : (autoRotateEnabled ? '#b380ff' : 'white');
        paths[0].setAttribute('d', icon.path1);
        if (icon.clip === 'left') paths[0].setAttribute('clip-path', 'url(#follow-toggle-clip)');
        else paths[0].removeAttribute('clip-path');
        if (icon.path2) {
            if (paths[1]) paths[1].setAttribute('d', icon.path2);
            else {
                const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                p2.setAttribute('d', icon.path2);
                p2.setAttribute('fill', color);
                toggleButton.querySelector('svg').appendChild(p2);
            }
        } else if (paths[1]) {
            paths[1].remove();
        }
        paths.forEach(p => p.setAttribute('fill', color));
    }

    function newChannelCooldown() {
        cooldownActive = true;
        clearTimeout(coolDownTimerId);

        coolDownTimerId = setTimeout(() => {
            cooldownActive = false;
        }, newChannelCooldownTimer);
    }

    function snoozeChannel() {
        if (cooldownActive) { // This is mostly so we dont accidentally snooze a channel the moment that its clicked
            // console.log('Snooze button on cooldown');
            return;
        }

        // Remove channel from snooze list if it's already there
        if (snoozedList.includes(window.location.pathname)) {
            snoozedList = snoozedList.filter(item => item !== window.location.pathname);
            updateFollowToggleIcon();
            return;
        }

        // Add channel to snoozedList
        snoozedList.push(window.location.pathname);
        // Remove snoozed channel from lastClickedHrefs so it doesn't clog things up
        lastClickedHrefs = lastClickedHrefs.filter(item => item !== window.location.pathname);
        // While in 'discover' mode, don't use the snoozed channel as a source of similar channels
        similarChannelClickCount = maxSimilarChannelClicks;
        clickRandomChannel();
        resetChannelRotationTimer();
    }

    function expandChannelSections() {
        let showMoreButtons = document.querySelectorAll('[data-a-target="side-nav-show-more-button"]');
        showMoreButtons?.forEach(button => button.click());
    }

    function getChannelsBySection(ariaLabel) {
        const section = document.querySelector(`[aria-label="${ariaLabel}"]`) || document.querySelector(`[aria-label$="${ariaLabel}"]`);
        return section ? section.querySelectorAll('a.tw-link') : [];
    }

    // Filter out offline, snoozed, and already clicked channels
    function filterQualifyingChannels(allChannels) {
        return allChannels.filter(channel => {
            let isOffline = channel.querySelector('div.side-nav-card__avatar--offline');
            let href = channel.getAttribute('href')
            return (!isOffline && !snoozedList.includes(href) && !lastClickedHrefs.includes(href) && href !== window.location.pathname);
        });
    }

    function selectQualifyingChannel(allChannels) {
        let liveChannels = filterQualifyingChannels(allChannels);

        // No eligible channels. (Probably just need to start looping.)
        if (!liveChannels.length) {
            if (!allChannels.length) {
                // Something is actually broken
                console.log('No qualifying live channels found.');
                return;
            }
            // If we're out of new channels to click, remove the oldest one and start over.
            if (lastClickedHrefs.length) lastClickedHrefs.shift();
            // If everything is snoozed but continuous mode is still on, unsnoozed the oldest snoozed channel. (This is not a great solution.)
            else if (snoozedList.length) snoozedList.shift();
            // Run selectQualifyingChannel() again and get the results
            return selectQualifyingChannel(allChannels);
        }

        // If there multiple channel options, choose randomly.
        // Random selection only happens on the first loop, then we iterate through that list using the code above.
        return liveChannels.length === 1 ? liveChannels[0] : liveChannels[Math.floor(Math.random() * liveChannels.length)];
    }

    function clickPreviousChannel() {
        if (cooldownActive) {
            console.log('Back button on cooldown');
            return;
        }

        if (window.history.length <= 1) {
            console.log('No previous page in history');
            return;
        }

        try {
            newChannelCooldown();
            channelRotationTimer('disable');
            window.history.back();
        } catch (error) {
            console.error('Navigation failed:', error);
        }
    }

    function clickRandomChannel() {
        if (cooldownActive) {
            // console.log('Next button on cooldown');
            return;
        }

        // Click "Show More" buttons
        expandChannelSections();

        // Get all channels on screen
        let followedChannels = getChannelsBySection("Followed Channels");
        let recommendedChannels = getChannelsBySection("Live Channels");
        let similarChannels = getChannelsBySection("Viewers Also Watch");

        // Check if any channels were found
        if (!followedChannels.length && !recommendedChannels.length && !similarChannels.length) {
            console.log('No channels found.');
            return;
        }

        let allChannels;
        // Filter channels by type
        switch (shuffleType) {
            case 'followed':
                allChannels = [...followedChannels];
                break;
            case 'recommended':
                allChannels = [...followedChannels, ...recommendedChannels];
                break;
            case 'discover': // Force selection from followedChannels if too many similarChannels have been clicked in a row
                allChannels = (similarChannelClickCount >= maxSimilarChannelClicks) ?
                    [...followedChannels, ...recommendedChannels] : [...followedChannels, ...recommendedChannels, ...similarChannels];
                break;
        }

        let newChannel = selectQualifyingChannel(allChannels);
        let newHref = newChannel.getAttribute('href');
        lastClickedHrefs.push(newHref);

        if ([...similarChannels].includes(newChannel)) {
            similarChannelClickCount++;
        } else similarChannelClickCount = 0; // Reset if a baseline channel is clicked

        // Build lastClickedFollowed and lastClickedNotFollowed lists for the log
        let lastClickedFollowed = lastClickedHrefs.filter(
            href => Array.from(followedChannels).some(channel => href === channel.getAttribute('href'))
        );
        let lastClickedNotFollowed = lastClickedHrefs.filter(
            href => !lastClickedFollowed.includes(href)
        );

        let logMessage = ``;
        if (snoozedList.length) {
            logMessage += `${snoozedList.length} snoozed\n\n`;
        }
        if (lastClickedFollowed.length) {
            logMessage += `Followed:\n${lastClickedFollowed.join("\n")}\n\n`;
        }
        if (lastClickedNotFollowed.length) {
            logMessage += `Not followed:\n${lastClickedNotFollowed.join("\n")}`;
        }
        console.log(logMessage);

        // Click the new channel and reset all timers
        newChannelCooldown();
        newChannel.click();
        channelRotationTimer('enable');
        resetChannelRotationTimer();
    }

    function channelRotationTimer(action = 'toggle') {
        if (autoRotateEnabled) {
            if (action == 'disable' || action == 'toggle') {
                autoRotateEnabled = false;
                resetChannelRotationTimer();
                updateFollowToggleIcon();
            }
        }
        else if (!autoRotateEnabled) {
            if (action == 'enable' || action == 'toggle') {
                autoRotateEnabled = true;
                clickRandomChannel(); // Run immediately, then start timer.
                resetChannelRotationTimer();
                updateFollowToggleIcon();
            }
        }
    }

    function resetChannelRotationTimer() {
        clearInterval(rotationTimerId);
        if (autoRotateEnabled) {
            rotationTimerId = setInterval(() => clickRandomChannel(), rotationTimer);
        }
    }

    function toggleShuffleType() {
        // Toggle the shuffleType variable
        switch (shuffleType) {
            case 'followed':
                shuffleType = 'recommended';
                rotationTimer = recommendedChannelTimer;
                break;
            case 'recommended':
                shuffleType = 'discover';
                rotationTimer = discoverChannelTimer;
                break;
            case 'discover':
                shuffleType = 'followed';
                rotationTimer = followedChannelTimer;
                break;
        }

        // Update the SVG icon of the toggle button
        const toggleButton = document.querySelector('button[data-a-target="player-follow-toggle-button"]');
        let paths = toggleButton.querySelectorAll('path');
        const newPaths = svgPaths[shuffleType];
        paths[0].setAttribute('d', newPaths.path1);
        if (newPaths.clip === 'left') paths[0].setAttribute('clip-path', 'url(#follow-toggle-clip)');
        else paths[0].removeAttribute('clip-path');
        if (newPaths.path2) {
            if (paths[1]) paths[1].setAttribute('d', newPaths.path2);
        } else if (paths[1]) {
            paths[1].remove();
        }

        updateFollowToggleIcon();
    }

    function insertButton(type, clickHandler, svgPaths, color, scale = 1) {
        const controlGroup = document.querySelector('[class*="player-controls__left-control-group"]');
        if (!controlGroup) return;

        const muteButton = controlGroup.querySelector('button[data-a-target="player-mute-unmute-button"]');
        if (!muteButton) return;

        const existingButton = controlGroup.querySelector(`button[data-a-target="player-${type}-button"]`);
        if (existingButton) return;

        // Create the button element based on the mute button so spacing matches
        const button = document.createElement('button');
        button.addEventListener('click', clickHandler);

        // Copy the class list from the mute button to keep styling consistent
        button.className = muteButton.className;

        // Set attributes
        button.setAttribute('aria-label', type.charAt(0).toUpperCase() + type.slice(1));
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('data-a-target', `player-${type}-button`);

        // Create SVG wrapper hierarchy similar to Twitch buttons
        const figure = muteButton.querySelector('div[class^="ButtonIconFigure"]');
        const figureEl = figure ? figure.cloneNode(false) : document.createElement('div');
        if (figure) figureEl.className = figure.className;

        const wrapper = muteButton.querySelector('div[class^="ScSvgWrapper"]');
        const wrapperEl = wrapper ? wrapper.cloneNode(false) : document.createElement('div');
        if (wrapper) wrapperEl.className = wrapper.className;

        // Create the SVG element
        const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgElement.setAttribute('style', `color: ${color}; transform: scale(${scale}); transform-origin: center; overflow: visible;`);
        svgElement.setAttribute('width', '20');
        svgElement.setAttribute('height', '20');
        svgElement.setAttribute('fill', 'currentColor');
        svgElement.setAttribute('viewBox', '0 0 16 16');

        const clipId = `${type}-clip`;
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        clipPath.setAttribute('id', clipId);
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', '0');
        rect.setAttribute('y', '0');
        rect.setAttribute('width', '8');
        rect.setAttribute('height', '16');
        clipPath.appendChild(rect);
        defs.appendChild(clipPath);
        svgElement.appendChild(defs);

        const pathElement1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathElement1.setAttribute('fill-rule', 'evenodd');
        pathElement1.setAttribute('d', svgPaths.path1);
        pathElement1.setAttribute('fill', color);
        if (svgPaths.clip === 'left') pathElement1.setAttribute('clip-path', `url(#${clipId})`);
        svgElement.appendChild(pathElement1);

        if (svgPaths.path2) {
            const pathElement2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            pathElement2.setAttribute('d', svgPaths.path2);
            pathElement2.setAttribute('fill', color);
            svgElement.appendChild(pathElement2);
        }

        wrapperEl.appendChild(svgElement);
        figureEl.appendChild(wrapperEl);
        button.appendChild(figureEl);

        muteButton.insertAdjacentElement('beforebegin', button);
    }

    setInterval(function() {
        insertButton('follow-toggle', () => toggleShuffleType(), svgPaths[shuffleType], 'white', 0.8);

        updateFollowToggleIcon();

        // Manually clicking channels resets the timer and adds them to the recently clicked queue
        if (lastClickedHrefs[lastClickedHrefs.length - 1] !== window.location.pathname) {
            lastClickedHrefs.push(window.location.pathname);
            channelRotationTimer('disable');
            // resetChannelRotationTimer();
        }
    }, 500);

    // Enable AirPod & media key controls
    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('nexttrack', () => {
            clickRandomChannel();
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => {
            clickPreviousChannel();
        });
    }

    document.addEventListener("keydown", function(event) {
        // Do nothing if the user is typing in an input field, textarea, or an editable element
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable) return;

        switch (event.key) {
            case 'x':
                snoozeChannel();
                break;
            case 'o':
                channelRotationTimer('disable');
                break;
            case '.': // Forward
                clickRandomChannel();
                break;
            case ',': // Back
                clickPreviousChannel();
                break;
        }
    });
})();
