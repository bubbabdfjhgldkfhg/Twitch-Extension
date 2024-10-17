// ==UserScript==
// @name         Shuffle
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      0.7
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

const continuousShuffle1 = "M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z";
const continuousShuffle2 = "M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z";

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

    // ===========================
    //          CONFIG
    // ===========================

    let shuffleType = 'followed'; // Default (the options are ['followed', 'recommended', 'discover'])

    // The channel timer determines how long to stay on each channel in continuous shuffle mode (1000 * seconds = milliseconds)
    let followedChannelTimer = 1000 * 20;
    let recommendedChannelTimer = 1000 * 18;
    let discoverChannelTimer = 1000 * 7.5;
    let rotationTimer = followedChannelTimer; // Default (keep this the same as the shuffle type, the options are above.)

    let newChannelCooldownTimer = 1000 * 2.6; // Minimum delay between channel clicks. Things break if you go too fast.
    let maxSimilarChannelClicks = 7; // How many channels deep to go in 'discover' mode.

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
            console.log('Snooze button on cooldown');
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
        window.history.back();
        newChannelCooldown();
        channelRotationTimer('disable');
    }

    function clickRandomChannel() {
        if (cooldownActive) {
            console.log('Next button on cooldown');
            return;
        }

        // Click "Show More" buttons
        expandChannelSections();

        // Get all channels on screen
        let followedChannels = getChannelsBySection("Followed Channels");
        let recommendedChannels = getChannelsBySection("Recommended Channels");
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

        console.log(`${snoozedList.length} snoozed\nLast ${lastClickedHrefs.length} channels:\n\n${lastClickedHrefs.join("\n")}`);

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

    function insertButton(type, clickHandler, svgPaths, color) {
        const controlGroup = document.querySelector('.cFsYRp.player-controls__left-control-group');
        if (!controlGroup) return;

        const pauseButton = controlGroup.querySelector('.InjectLayout-sc-1i43xsx-0.kBtJDm');
        if (!pauseButton) return;

        const existingButton = controlGroup.querySelector(`button[data-a-target="player-${type}-button"]`);
        if (existingButton) return;

        // Create the button element
        const button = document.createElement('button');
        button.addEventListener('click', clickHandler);

        // Set attributes
        button.className = 'ScCoreButton-sc-ocjdkq-0 caieTg ScButtonIcon-sc-9yap0r-0 dOOPAe';
        button.setAttribute('aria-label', type.charAt(0).toUpperCase() + type.slice(1));
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('data-a-target', `player-${type}-button`);

        // Create the SVG element
        const svgElement = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svgElement.setAttribute("style", "color: ${color}");
        svgElement.setAttribute("width", "16");
        svgElement.setAttribute("height", "16");
        svgElement.setAttribute("fill", "currentColor");
        svgElement.setAttribute("viewBox", "0 0 16 16");

        const pathElement1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        pathElement1.setAttribute("fill-rule", "evenodd");
        pathElement1.setAttribute("d", svgPaths.path1);
        pathElement1.setAttribute("fill", color);
        svgElement.appendChild(pathElement1);

        if (svgPaths.path2) {
            const pathElement2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
            pathElement2.setAttribute("d", svgPaths.path2);
            pathElement2.setAttribute("fill", color);
            svgElement.appendChild(pathElement2);
        }

        button.appendChild(svgElement);
        pauseButton.insertAdjacentElement('afterend', button);
    }

    setInterval(function() {
        insertButton('snooze', () => snoozeChannel(), svgPaths.snooze, "red");
        insertButton('continuous', () => channelRotationTimer('toggle'), svgPaths.continuous, "#b380ff");
        insertButton('follow-toggle', () => toggleShuffleType(), svgPaths[shuffleType], "white");

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
