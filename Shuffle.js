// ==UserScript==
// @name         Shuffle
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      3.9
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

const svgPaths = {
    followed: { path1: heartFill, path2: null },
    recommended: { path1: heartHalfFill, path2: null },
    discover: { path1: heartNoFill, path2: null }
};

let clientVersion = null;
let clientSession = null;
let clientIntegrityHeader = null;
let authorizationHeader = null;
let deviceId = null;

(function() {
    'use strict';

    hookFetch();

    // ===========================
    //          CONFIG
    // ===========================

    let shuffleType = 'followed'; // Default (the options are ['followed', 'recommended', 'discover'])

    // The channel timer determines how long to stay on each channel in continuous shuffle mode (1000 * seconds = milliseconds)
    let followedChannelTimer = 1000 * 25;
    let recommendedChannelTimer = 1000 * 20;
    let discoverChannelTimer = 1000 * 7;
    let rotationTimer = followedChannelTimer; // Default (keep this the same as the shuffle type, the options are above.)

    let newChannelCooldownTimer = 1000 * 3; // Minimum delay between channel clicks. Things break if you go too fast.
    let maxSimilarChannelClicks = 15; // How many channels deep to go in 'discover' mode.

    const X_KEY_HOLD_DURATION = 400; // How long to hold X
    const Y_KEY_HOLD_DURATION = 800; // How long to hold Y
    const B_KEY_HOLD_DURATION = 800; // How long to hold B to block
    const removeSuperSnoozeDialogTimeout = 1000 * 3.5; // How long before the Not Interested dialogue disappears

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
    let rotationTimerStart = null;
    let playbackResetTimeoutId = null;
    let similarChannelClickCount = 0;
    const playbackStatePollInterval = 250;
    const playbackCheckCooldown = 1500;
    let playbackCheckIntervalId = null;
    let videoPlayerInstance = null;
    let xKeyHoldTimer = null;
    let xKeyHoldStart = null;
    let bKeyHoldStart = null;
    let dialogCreated = false;
    let superSnoozeDialog = null;
    let dialogDismissTimeout = null;
    let dialogDismissStart = null;
    let dialogCountdownPaused = false;
    let countdownBarAnimationId = null;
    let yHoldBarAnimationId = null;
    let bHoldBarAnimationId = null;




    // Add this function to intercept headers
    function hookFetch() {
        const realFetch = window.fetch;
        window.fetch = function(url, init, ...args) {
            if (typeof url === 'string') {
                if (url.includes('/access_token') || url.includes('gql')) {
                    if (init?.headers) {
                        if (url.includes('origin=twilight')) {
                            deviceId = init.headers['X-Device-Id'] || init.headers['Device-ID'] || deviceId;
                            clientVersion = init.headers['Client-Version'] || clientVersion;
                            clientSession = init.headers['Client-Session-Id'] || clientSession;
                            clientIntegrityHeader = init.headers['Client-Integrity'] || clientIntegrityHeader;
                            authorizationHeader = init.headers['Authorization'] || authorizationHeader;
                        }
                    }
                }
            }
            return realFetch.apply(this, arguments);
        };
    }

    // Add this function to build headers
    function getGqlHeaders() {
        const headers = {
            'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
            'Content-Type': 'application/json'
        };

        if (deviceId) {
            headers['X-Device-Id'] = deviceId;
            headers['Device-ID'] = deviceId;
        }
        if (clientVersion) headers['Client-Version'] = clientVersion;
        if (clientSession) headers['Client-Session-Id'] = clientSession;
        if (clientIntegrityHeader) headers['Client-Integrity'] = clientIntegrityHeader;
        if (authorizationHeader) headers['Authorization'] = authorizationHeader;

        return headers;
    }

    // Add function to get channel ID
    async function getChannelId(channelLogin) {
        const query = {
            query: `query { user(login: "${channelLogin}") { id } }`
    };

        const response = await fetch('https://gql.twitch.tv/gql', {
            method: 'POST',
            headers: getGqlHeaders(),
            body: JSON.stringify(query)
        });

        const data = await response.json();
        return data.data?.user?.id;
    }

    // Add function to send "not interested" GraphQL mutation
    async function sendNotInterestedMutation(channelId) {
        const body = [{
            operationName: 'AddRecommendationFeedback',
            query: `mutation AddRecommendationFeedback($input: AddRecommendationFeedbackInput!) {
            addRecommendationFeedback(input: $input) {
                __typename
            }
        }`,
            variables: {
                input: {
                    category: 'NOT_INTERESTED',
                    itemID: channelId,
                    itemType: 'CHANNEL',
                    sourceItemPage: 'twitch_home',
                    sourceItemRequestID: 'JIRA-VXP-2397',
                    sourceItemTrackingID: ''
                }
            }
        }];

        await fetch('https://gql.twitch.tv/gql#origin=twilight', {
            method: 'POST',
            headers: getGqlHeaders(),
            body: JSON.stringify(body)
        });
    }

    // Add function to send block user GraphQL mutation
    async function sendBlockUserMutation(channelId) {
        const body = [{
            operationName: 'BlockUser',
            query: `mutation BlockUser($input: BlockUserInput!) {
            blockUser(input: $input) {
                __typename
            }
        }`,
            variables: {
                input: {
                    targetUserID: channelId,
                    sourceContext: 'CHAT'
                }
            }
        }];

        await fetch('https://gql.twitch.tv/gql#origin=twilight', {
            method: 'POST',
            headers: getGqlHeaders(),
            body: JSON.stringify(body)
        });
    }

    // Add function to create super snooze dialog
    function createSuperSnoozeDialog() {
        if (superSnoozeDialog) return;

        const dialog = document.createElement('div');
        const showDepthMessage = similarChannelClickCount >= 2;
        const borderColor = showDepthMessage ? '#ff0000' : '#b380ff';
        const depthMessage = showDepthMessage
            ? `<div style="color: #ff4d4d; margin-top: 8px;">You are ${similarChannelClickCount} channels deep</div>`
            : '';

        dialog.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 20px;
        padding-bottom: 30px;
        border-radius: 8px;
        z-index: 10000;
        font-size: 16px;
        text-align: center;
        border: 2px solid ${borderColor};
    `;
        dialog.innerHTML = `
        <div>Permanently snooze this channel?</div>
        ${depthMessage}
        <div style="margin-top: 10px; font-size: 14px; color: #888;">
            Hold <span style="color: #ff0000;">Y</span> for not interested, <span style="color: #ff6600;">B</span> to block, any other key to cancel
        </div>
        <div style="position: absolute; bottom: 10px; left: 5px; right: 5px; height: 3px; background: rgba(255, 0, 0, 0.3); border-radius: 2px;">
            <div data-progress-bar="yhold" style="position: absolute; left: 0; top: 0; bottom: 0; width: 0%; background: #ff0000; border-radius: 2px; transition: width 0.05s linear; will-change: width;"></div>
        </div>
        <div style="position: absolute; bottom: 5px; left: 5px; right: 5px; height: 3px; background: rgba(255, 102, 0, 0.3); border-radius: 2px;">
            <div data-progress-bar="bhold" style="position: absolute; left: 0; top: 0; bottom: 0; width: 0%; background: #ff6600; border-radius: 2px; transition: width 0.05s linear; will-change: width;"></div>
        </div>
        <div style="position: absolute; bottom: 0px; left: 5px; right: 5px; height: 3px; background: rgba(179, 128, 255, 0.3); border-radius: 2px;">
            <div data-progress-bar="countdown" style="position: absolute; left: 0; top: 0; bottom: 0; width: 100%; background: #b380ff; border-radius: 2px; transition: width 0.05s linear; will-change: width;"></div>
        </div>
    `;

        document.body.appendChild(dialog);
        superSnoozeDialog = dialog;
        dialogCreated = true;

        dialogDismissStart = performance.now();
        dialogCountdownPaused = false;

        // Start countdown bar animation
        function updateCountdownBar() {
            if (!superSnoozeDialog || !dialogCreated) {
                cancelAnimationFrame(countdownBarAnimationId);
                return;
            }

            const countdownBar = superSnoozeDialog.querySelector('[data-progress-bar="countdown"]');
            if (!countdownBar) return;

            if (!dialogCountdownPaused) {
                const elapsed = performance.now() - dialogDismissStart;
                const progress = Math.max(0, 1 - (elapsed / removeSuperSnoozeDialogTimeout));
                countdownBar.style.width = `${progress * 100}%`;

                if (progress <= 0) {
                    removeSuperSnoozeDialog();
                    return;
                }
            }

            countdownBarAnimationId = requestAnimationFrame(updateCountdownBar);
        }
        countdownBarAnimationId = requestAnimationFrame(updateCountdownBar);
    }

    function removeSuperSnoozeDialog() {
        if (superSnoozeDialog) {
            superSnoozeDialog.remove();
            superSnoozeDialog = null;
            dialogCreated = false;
        }

        if (countdownBarAnimationId) {
            cancelAnimationFrame(countdownBarAnimationId);
            countdownBarAnimationId = null;
        }
        if (yHoldBarAnimationId) {
            cancelAnimationFrame(yHoldBarAnimationId);
            yHoldBarAnimationId = null;
        }
        if (bHoldBarAnimationId) {
            cancelAnimationFrame(bHoldBarAnimationId);
            bHoldBarAnimationId = null;
        }
        if (dialogDismissTimeout) {
            clearTimeout(dialogDismissTimeout);
            dialogDismissTimeout = null;
        }
        if (xKeyHoldTimer) {
            clearTimeout(xKeyHoldTimer);
            xKeyHoldTimer = null;
        }
        dialogDismissStart = null;
        dialogCountdownPaused = false;
        xKeyHoldStart = null;
        bKeyHoldStart = null;
    }

    async function handleSuperSnooze() {
        const currentChannel = getUsernameFromUrl();
        if (!currentChannel) return;

        try {
            const channelId = await getChannelId(currentChannel);
            if (channelId) {
                await sendNotInterestedMutation(channelId);
                console.log(`Permanently snoozed channel: ${currentChannel}`);
                snoozeChannel();
            }
        } catch (error) {
            console.error('Failed to super snooze channel:', error);
        }
    }

    async function handleBlock() {
        const currentChannel = getUsernameFromUrl();
        if (!currentChannel) return;

        try {
            const channelId = await getChannelId(currentChannel);
            if (channelId) {
                await sendBlockUserMutation(channelId);
                console.log(`Blocked user: ${currentChannel}`);
                snoozeChannel();
            }
        } catch (error) {
            console.error('Failed to block user:', error);
        }
    }

    function getUsernameFromUrl() {
        const pathname = window.location.pathname;
        const match = pathname.match(/^\/([^\/]+)/);
        return match ? match[1] : null;
    }





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

        const svgElement = toggleButton.querySelector('svg');
        if (!svgElement) return;

        let countdownText = svgElement.querySelector('text[data-a-target="shuffle-countdown"]');
        if (!countdownText) {
            countdownText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            countdownText.setAttribute('data-a-target', 'shuffle-countdown');
            countdownText.setAttribute('x', '8');
            countdownText.setAttribute('y', '10');
            countdownText.setAttribute('text-anchor', 'middle');
            countdownText.setAttribute('fill', '#ffffff');
            countdownText.setAttribute('font-size', '9.5');
            countdownText.setAttribute('font-family', 'sans-serif');
            countdownText.setAttribute('pointer-events', 'none');
            svgElement.appendChild(countdownText);
        }

        let countdownContent = '';
        if (autoRotateEnabled && rotationTimerStart && rotationTimerId) {
            const msRemaining = (rotationTimerStart + rotationTimer) - Date.now();
            if (msRemaining > 0) {
                countdownContent = Math.max(0, Math.round(msRemaining / 1000)).toString();
            } else {
                countdownContent = '0';
            }
        }

        countdownText.textContent = countdownContent;
    }

    function newChannelCooldown() {
        cancelXHoldTimer();
        cooldownActive = true;
        clearTimeout(coolDownTimerId);

        coolDownTimerId = setTimeout(() => {
            cooldownActive = false;
        }, newChannelCooldownTimer);
    }

    function cancelXHoldTimer() {
        if (xKeyHoldTimer) {
            clearTimeout(xKeyHoldTimer);
            xKeyHoldTimer = null;
        }
        xKeyHoldStart = null;
    }

    function snoozeChannel() {
        if (cooldownActive || dialogCreated) {
            return;
        }

        // [Toggler] Unsnooze
        if (snoozedList.includes(window.location.pathname)) {
            snoozedList = snoozedList.filter(item => item !== window.location.pathname);
            updateFollowToggleIcon();
            return;
        }

        snoozedList.push(window.location.pathname);
        lastClickedHrefs = lastClickedHrefs.filter(item => item !== window.location.pathname);
        similarChannelClickCount = maxSimilarChannelClicks;
        clickRandomChannel();
        resetChannelRotationTimerWithCooldown();
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
        resetChannelRotationTimerWithCooldown();
    }

    function findReactNode(root, constraint) {
        if (!root) return null;
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
        const rootNode = document.querySelector('#root');
        if (!rootNode) return null;
        let reactRootNode = rootNode?._reactRootContainer?._internalRoot?.current;
        if (!reactRootNode) {
            const containerName = Object.keys(rootNode).find(name => name.startsWith('__reactContainer'));
            if (containerName) reactRootNode = rootNode[containerName];
        }
        return reactRootNode;
    }

    function getVideoPlayerInstance() {
        if (videoPlayerInstance?.getHTMLVideoElement) {
            const videoElement = videoPlayerInstance.getHTMLVideoElement();
            if (videoElement && document.contains(videoElement)) {
                return videoPlayerInstance;
            }
            videoPlayerInstance = null;
        }

        const reactRootNode = findReactRootNode();
        if (!reactRootNode) return null;

        const playerNode = findReactNode(
            reactRootNode,
            node => node?.props?.mediaPlayerInstance && node.setPlayerActive
        );
        videoPlayerInstance = playerNode?.props?.mediaPlayerInstance ?? null;
        return videoPlayerInstance;
    }

    function isStreamPlaying() {
        const player = getVideoPlayerInstance();
        const state = player?.getState?.();
        return state === 'Playing';
    }

    function stopPlaybackWatcher() {
        if (playbackCheckIntervalId) {
            clearInterval(playbackCheckIntervalId);
            playbackCheckIntervalId = null;
        }
    }

    function startPlaybackWatcher() {
        if (playbackCheckIntervalId) return;
        playbackCheckIntervalId = setInterval(() => {
            if (!autoRotateEnabled) {
                stopPlaybackWatcher();
                return;
            }
            if (isStreamPlaying()) {
                stopPlaybackWatcher();
                resetChannelRotationTimer();
            }
        }, playbackStatePollInterval);
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
                resetChannelRotationTimerWithCooldown();
                updateFollowToggleIcon();
            }
        }
    }

    function resetChannelRotationTimer() {
        clearInterval(rotationTimerId);
        rotationTimerId = null;
        rotationTimerStart = null;

        if (!autoRotateEnabled) {
            stopPlaybackWatcher();
            return;
        }

        if (isStreamPlaying()) {
            stopPlaybackWatcher();
            rotationTimerStart = Date.now();
            rotationTimerId = setInterval(() => {
                rotationTimerStart = Date.now();
                clickRandomChannel();
            }, rotationTimer);
        } else {
            startPlaybackWatcher();
        }
    }

    function resetChannelRotationTimerWithCooldown() {
        clearTimeout(playbackResetTimeoutId);
        playbackResetTimeoutId = setTimeout(() => {
            playbackResetTimeoutId = null;
            resetChannelRotationTimer();
        }, playbackCheckCooldown);
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
        resetChannelRotationTimer();
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
            cancelXHoldTimer();
            channelRotationTimer('disable');
            // resetChannelRotationTimer();
        }
    }, 500);

    //     function vtuberAutoSkip() {
    //         if (!autoRotateEnabled) return;
    //         const hasVtuberTag = [...document.querySelectorAll('a.tw-tag')]
    //         .some(a => (a.textContent || '').trim().toLowerCase() === 'vtuber');
    //         if (hasVtuberTag) snoozeChannel();
    //     }

    //     setInterval(vtuberAutoSkip, 2000);

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
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable) return;

        // Handle dialog responses
        if (dialogCreated && event.key.toLowerCase() === 'y') {
            if (!xKeyHoldTimer && !dialogCountdownPaused) {
                // Pause countdown
                dialogCountdownPaused = true;
                xKeyHoldStart = performance.now();

                // Start Y hold bar animation
                function updateYHoldBar() {
                    if (!superSnoozeDialog || !dialogCreated || !xKeyHoldStart) {
                        cancelAnimationFrame(yHoldBarAnimationId);
                        return;
                    }

                    const yHoldBar = superSnoozeDialog.querySelector('[data-progress-bar="yhold"]');
                    if (!yHoldBar) return;

                    const elapsed = performance.now() - xKeyHoldStart;
                    const progress = Math.min(1, elapsed / Y_KEY_HOLD_DURATION);
                    yHoldBar.style.width = `${progress * 100}%`;

                    if (progress >= 1) {
                        removeSuperSnoozeDialog();
                        handleSuperSnooze();
                        return;
                    }

                    yHoldBarAnimationId = requestAnimationFrame(updateYHoldBar);
                }
                yHoldBarAnimationId = requestAnimationFrame(updateYHoldBar);
            }
            return;
        }

        // Handle B key for block in dialog
        if (dialogCreated && event.key.toLowerCase() === 'b') {
            if (!bKeyHoldStart && !dialogCountdownPaused) {
                // Pause countdown
                dialogCountdownPaused = true;
                bKeyHoldStart = performance.now();

                // Start B hold bar animation
                function updateBHoldBar() {
                    if (!superSnoozeDialog || !dialogCreated || !bKeyHoldStart) {
                        cancelAnimationFrame(bHoldBarAnimationId);
                        return;
                    }

                    const bHoldBar = superSnoozeDialog.querySelector('[data-progress-bar="bhold"]');
                    if (!bHoldBar) return;

                    const elapsed = performance.now() - bKeyHoldStart;
                    const progress = Math.min(1, elapsed / B_KEY_HOLD_DURATION);
                    bHoldBar.style.width = `${progress * 100}%`;

                    if (progress >= 1) {
                        removeSuperSnoozeDialog();
                        handleBlock();
                        return;
                    }

                    bHoldBarAnimationId = requestAnimationFrame(updateBHoldBar);
                }
                bHoldBarAnimationId = requestAnimationFrame(updateBHoldBar);
            }
            return;
        }

        // Handle other keys in dialog
        if (dialogCreated && event.key.toLowerCase() !== 'x') {
            removeSuperSnoozeDialog();
            return;
        }

        switch (event.key) {
            case 'x':
                if (!xKeyHoldTimer && !event.ctrlKey) {
                    xKeyHoldStart = performance.now();
                    xKeyHoldTimer = setTimeout(() => {
                        channelRotationTimer('disable');
                        createSuperSnoozeDialog();
                        xKeyHoldTimer = null;
                    }, X_KEY_HOLD_DURATION);
                }
                break;
            case 'o':
                channelRotationTimer('disable');
                break;
            case '.':
                clickRandomChannel();
                break;
            case ',':
                clickPreviousChannel();
                break;
        }
    });

    document.addEventListener("keyup", function(event) {
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable) return;

        // Handle Y release in dialog
        if (dialogCreated && event.key.toLowerCase() === 'y') {
            if (xKeyHoldTimer) {
                clearTimeout(xKeyHoldTimer);
                xKeyHoldTimer = null;
            }
            if (yHoldBarAnimationId) {
                cancelAnimationFrame(yHoldBarAnimationId);
                yHoldBarAnimationId = null;
            }

            // Reset Y hold bar
            const yHoldBar = superSnoozeDialog?.querySelector('[data-progress-bar="yhold"]');
            if (yHoldBar) {
                yHoldBar.style.width = '0%';
            }

            // Resume countdown
            if (dialogCountdownPaused && xKeyHoldStart) {
                dialogCountdownPaused = false;
                const pausedDuration = performance.now() - xKeyHoldStart;
                dialogDismissStart += pausedDuration;
            }

            xKeyHoldStart = null;
            return;
        }

        // Handle B release in dialog
        if (dialogCreated && event.key.toLowerCase() === 'b') {
            if (bHoldBarAnimationId) {
                cancelAnimationFrame(bHoldBarAnimationId);
                bHoldBarAnimationId = null;
            }

            // Reset B hold bar
            const bHoldBar = superSnoozeDialog?.querySelector('[data-progress-bar="bhold"]');
            if (bHoldBar) {
                bHoldBar.style.width = '0%';
            }

            // Resume countdown
            if (dialogCountdownPaused && bKeyHoldStart) {
                dialogCountdownPaused = false;
                const pausedDuration = performance.now() - bKeyHoldStart;
                dialogDismissStart += pausedDuration;
            }

            bKeyHoldStart = null;
            return;
        }

        if (event.key === 'x' && !event.ctrlKey) {
            if (xKeyHoldTimer) {
                // Key released before Not Interested dialogue - do normal snooze
                clearTimeout(xKeyHoldTimer);
                xKeyHoldTimer = null;
                if (!dialogCreated) {
                    snoozeChannel();
                }
            }
            xKeyHoldStart = null;
        }
    });

    document.addEventListener('click', function(event) {
        if (!xKeyHoldTimer) return;
        const channelLink = event.target.closest('a.tw-link');
        if (!channelLink) return;

        cancelXHoldTimer();
    }, true);

})();
