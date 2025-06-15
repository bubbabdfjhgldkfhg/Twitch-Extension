// ==UserScript==
// @name         Shuffle
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      1.10
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
const heartNoFillArrow = "M8 15C23.333 4.867 12.72 -3.042 8.176 1.144 C7.943 1.255 7.884 1.198 7.824 1.143 C3.279 -3.04 -7.333 4.868 8 15 M8 2.748 L8.717 2.01 C10.4 0.28 13.486 0.878 14.6 3.053 C15.124 4.076 15.241 5.552 14.286 7.438 C13.365 9.253 11.452 11.427 8 13.795 C4.548 11.427 2.634 9.253 1.714 7.438 C0.759 5.553 0.877 4.076 1.4 3.053 C2.514 0.878 5.6 0.281 7.283 2.011 L8 2.748";

const continuousShuffle1 = heartFill; // base heart
const continuousShuffle2 = heartNoFillArrow; // outline used for the tracing arrow

const snoozePath1 = "M4.54.146A.5.5 0 0 1 4.893 0h6.214a.5.5 0 0 1 .353.146l4.394 4.394a.5.5 0 0 1 .146.353v6.214a.5.5 0 0 1-.146.353l-4.394 4.394a.5.5 0 0 1-.353.146H4.893a.5.5 0 0 1-.353-.146L.146 11.46A.5.5 0 0 1 0 11.107V4.893a.5.5 0 0 1 .146-.353L4.54.146zM5.1 1 1 5.1v5.8L5.1 15h5.8l4.1-4.1V5.1L10.9 1H5.1z";
const snoozePath2 = "M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z";

const svgPaths = {
    followed: { path1: heartFill, path2: null },
    recommended: { path1: heartHalfFill, path2: null },
    discover: { path1: heartNoFill, path2: null },
    continuous: { path1: continuousShuffle1, path2: continuousShuffle2 },
    snooze: { path1: snoozePath1, path2: snoozePath2 }
};

(function() {
    'use strict';

    // Add arrow tracing keyframes for the continuous button
    const style = document.createElement('style');
    style.textContent = `
        @keyframes heartTrace {
            from { stroke-dashoffset: 0; }
            to { stroke-dashoffset: -92; }
        }
        .heart-arrow {
            stroke-dasharray: 40 52;
            stroke-dashoffset: 0;
            animation: heartTrace 4s linear infinite;
            fill: none;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
    `;
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
            // Hide Unsnooze button
            let snoozeButton = document.querySelector('button[data-a-target="player-snooze-button"]');
            if (snoozeButton) snoozeButton.style.display = 'none';
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
        const continuousButton = document.querySelector('button[data-a-target="player-continuous-button"]');

        if (autoRotateEnabled) {
            if (action == 'disable' || action == 'toggle') {
                autoRotateEnabled = false;
                resetChannelRotationTimer();
                // Change color back to white
                if (continuousButton) continuousButton.style.display = 'none';
                // continuousButton?.querySelectorAll('path').forEach(path => path.setAttribute('fill', 'white'));
            }
        }
        else if (!autoRotateEnabled) {
            if (action == 'enable' || action == 'toggle') {
                autoRotateEnabled = true;
                clickRandomChannel(); // Run immediately, then start timer.
                resetChannelRotationTimer();
                // Change color to purple
                if (continuousButton) continuousButton.style.display = 'inline-flex';
                // Arrow animation handled via CSS
                // continuousButton?.querySelectorAll('path').forEach(path => path.setAttribute('fill', '#b380ff'));
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
        // if (newPaths.path2) paths[1].setAttribute('d', newPaths.path2);
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

        if (type === 'continuous') {
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', 'arrowhead');
            marker.setAttribute('markerWidth', '4');
            marker.setAttribute('markerHeight', '4');
            marker.setAttribute('refX', '2');
            marker.setAttribute('refY', '2');
            marker.setAttribute('orient', 'auto');
            marker.setAttribute('markerUnits', 'strokeWidth');
            const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            arrowPath.setAttribute('d', 'M0,0 L0,4 L4,2 Z');
            arrowPath.setAttribute('fill', color);
            marker.appendChild(arrowPath);
            defs.appendChild(marker);
            svgElement.appendChild(defs);
        }

        const pathElement1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathElement1.setAttribute('fill-rule', 'evenodd');
        pathElement1.setAttribute('d', svgPaths.path1);
        pathElement1.setAttribute('fill', type === 'continuous' ? 'white' : color);
        svgElement.appendChild(pathElement1);

        if (svgPaths.path2) {
            const pathElement2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            pathElement2.setAttribute('d', svgPaths.path2);
            if (type === 'continuous') {
                pathElement2.setAttribute('class', 'heart-arrow');
                pathElement2.setAttribute('stroke', color);
                pathElement2.setAttribute('stroke-width', '1.5');
                pathElement2.setAttribute('marker-end', 'url(#arrowhead)');
            } else {
                pathElement2.setAttribute('fill', color);
            }
            svgElement.appendChild(pathElement2);
        }

        wrapperEl.appendChild(svgElement);
        figureEl.appendChild(wrapperEl);
        button.appendChild(figureEl);

        muteButton.insertAdjacentElement('beforebegin', button);
    }

    setInterval(function() {
        insertButton('follow-toggle', () => toggleShuffleType(), svgPaths[shuffleType], 'white', 0.8);
        insertButton('snooze', () => snoozeChannel(), svgPaths.snooze, 'red', 0.85);
        const continuousIcon = { path1: svgPaths[shuffleType].path1, path2: heartNoFillArrow };
        insertButton('continuous', () => channelRotationTimer('toggle'), continuousIcon, '#b380ff', 1);

        // Turn the snooze button red if the current channel is snoozed
        let snoozeButton = document.querySelector('button[data-a-target="player-snooze-button"]');
        if (snoozedList.includes(window.location.pathname)) {
            if (snoozeButton) snoozeButton.style.display = 'inline-flex';
            // snoozeButton?.querySelectorAll('path').forEach(path => path.setAttribute('fill', 'red'));
        } else {
            if (snoozeButton) snoozeButton.style.display = 'none';
            // snoozeButton?.querySelectorAll('path').forEach(path => path.setAttribute('fill', 'white'));
        }
        // Make sure the Continuous button is purple if turned on
        let continuousButton = document.querySelector('button[data-a-target="player-continuous-button"]');
        if (autoRotateEnabled) {
            if (continuousButton) continuousButton.style.display = 'inline-flex';
            // Arrow animation handled via CSS
            // continuousButton?.querySelectorAll('path').forEach(path => path.setAttribute('fill', '#b380ff'));
        } else {
            if (continuousButton) continuousButton.style.display = 'none';
        }

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
