// ==UserScript==
// @name         Resolution
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      1.25
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
    const FAST_CHECK_INTERVAL = 25; // Check very fast in the critical first 500ms
    const FAST_CHECK_WINDOW = 500; // Fast checking for first 500ms
    const NORMAL_CHECK_INTERVAL = 150; // Normal checking after fast window
    const PAGE_CHANGE_WINDOW = 8000; // Monitor for 8 seconds after page change
    const DEBUG = true;
    let lastPageChange = 0;
    let videoPlayer = null;
    let loadingCheckTimer = null;
    let qualitySetForCurrentStream = false;
    let lastSeenQualityCount = 0;
    let bestQualityHeight = 0;
    let firstQualityDetectionTime = null;
    let streamStartedPlayingTime = null;
    let hasLoggedPlaybackStart = false;
    let lastSetQualityGroup = null;
    let skippedSwitchCount = 0;
    let hasLoggedSkipping = false;

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
            return false;
        }

        try {
            const qualities = videoPlayer.getQualities?.();
            const currentQuality = videoPlayer.getQuality?.();

            if (!qualities || qualities.length === 0) {
                return false;
            }

            if (!currentQuality) {
                log(`[${timeSincePageChange}ms] ⚠️  Qualities available but currentQuality is null/undefined`);
                return false;
            }

            // Check if currentQuality is valid (not empty/undefined name)
            if (!currentQuality.name || currentQuality.name === '') {
                log(`[${timeSincePageChange}ms] ⚠️  currentQuality has empty name - player not ready (height: ${currentQuality.height}, group: ${currentQuality.group})`);
                return false;
            }


            // Track when we first detect qualities for timing analysis
            if (!firstQualityDetectionTime) {
                firstQualityDetectionTime = Date.now();
                log(`[${timeSincePageChange}ms] 📊 First quality detection (page change + ${timeSincePageChange}ms)`);
            }

            const bestQuality = getBestQuality(qualities);
            if (!bestQuality) {
                log(`[${timeSincePageChange}ms] No best quality found (filtered: ${qualities.filter(q => q.group !== 'auto').length})`);
                return false;
            }

            // Check if quality list has expanded (new transcodes available)
            const qualityCountChanged = qualities.length !== lastSeenQualityCount;
            const betterQualityAvailable = bestQuality.height > bestQualityHeight;

            if (qualityCountChanged || betterQualityAvailable) {
                const qualityList = qualities.map(q => `${q.name} (${q.height}p${q.framerate || '?'})`).join(', ');
                log(`[${timeSincePageChange}ms] ${qualityCountChanged ? 'NEW' : 'BETTER'} qualities detected: [${qualityList}]`);
                log(`[${timeSincePageChange}ms] Current quality: ${currentQuality.name} (${currentQuality.height}p${currentQuality.framerate || '?'})`);
                lastSeenQualityCount = qualities.length;
                bestQualityHeight = bestQuality.height;
            }

            // Check video playback state for timing analysis
            const video = getVideoElement();
            const isLoading = isVideoLoading(video);
            const isPlaying = isVideoPlaying(video);

            // Track when stream actually starts playing (not rebuffering from our quality change)
            if (isPlaying && !hasLoggedPlaybackStart && firstQualityDetectionTime) {
                streamStartedPlayingTime = Date.now();
                const gapFromQualityDetection = streamStartedPlayingTime - firstQualityDetectionTime;
                const gapFromPageChange = streamStartedPlayingTime - lastPageChange;
                const qualityDetectedAt = firstQualityDetectionTime - lastPageChange;
                log(`[${timeSincePageChange}ms] 📊 Stream started playing (${gapFromQualityDetection}ms after quality detection, ${gapFromPageChange}ms after page change)`);
                log(`📊 TIMING SUMMARY: Quality detected at ${qualityDetectedAt}ms, Stream started at ${gapFromPageChange}ms, Gap: ${gapFromQualityDetection}ms`);
                hasLoggedPlaybackStart = true;

                // Check quality 1 second after stream starts to detect if Twitch changes it
                const qualityAtStart = currentQuality.name;
                const qualityGroupAtStart = currentQuality.group;
                setTimeout(() => {
                    const qualityAfter1s = videoPlayer?.getQuality?.();
                    if (qualityAfter1s && qualityAfter1s.name) {
                        if (qualityAfter1s.group !== qualityGroupAtStart) {
                            log(`[${Date.now() - lastPageChange}ms] 👀 Quality changed 1s after stream start: ${qualityAtStart} → ${qualityAfter1s.name}`);
                        } else {
                            log(`[${Date.now() - lastPageChange}ms] 👀 Quality still ${qualityAfter1s.name} 1s after stream start ✓`);
                        }
                    }
                }, 1000);
            }

            if (isBestQuality(currentQuality, qualities)) {
                if (!qualitySetForCurrentStream || qualityCountChanged || betterQualityAvailable) {
                    log(`[${timeSincePageChange}ms] ✓ At best quality: ${currentQuality.name} (${currentQuality.height}p${currentQuality.framerate})`);
                    qualitySetForCurrentStream = true;
                }
                return false; // Keep checking in case better qualities appear
            }

            // Prevent duplicate setQuality calls
            if (bestQuality.group === lastSetQualityGroup) {
                return false;
            }

            // Need to switch quality - only do it if video is loading or not playing
            if (force || isLoading || !isPlaying) {
                // Double-check currentQuality is still valid before switching
                const recheck = videoPlayer.getQuality?.();
                if (!recheck || !recheck.name || recheck.name === '') {
                    log(`[${timeSincePageChange}ms] ⚠️  Skipping switch - player not ready (recheck failed)`);
                    return false;
                }

                // Check if video element is ready (readyState >= 1 means HAVE_METADATA or better)
                if (video && video.readyState === 0) {
                    if (!hasLoggedSkipping) {
                        log(`[${timeSincePageChange}ms] ⚠️  Video not ready (readyState=0), waiting for metadata...`);
                        hasLoggedSkipping = true;
                    }
                    skippedSwitchCount++;
                    return false;
                }

                // Log skipped count if we had to wait
                if (skippedSwitchCount > 0) {
                    log(`[${timeSincePageChange}ms] Skipped ${skippedSwitchCount} attempts while waiting for video to load`);
                }

                log(`[${timeSincePageChange}ms] ✓ Switching: "${currentQuality.name}" → "${bestQuality.name}" (${bestQuality.height}p${bestQuality.framerate}) [loading: ${isLoading}, playing: ${isPlaying}]`);

                // Log detailed video element state
                if (video) {
                    log(`[${timeSincePageChange}ms] 📹 Video state: readyState=${video.readyState}, networkState=${video.networkState}, paused=${video.paused}, seeking=${video.seeking}, buffered=${video.buffered.length > 0 ? video.buffered.end(0).toFixed(1) : 0}s`);
                }

                log(`[${timeSincePageChange}ms] 🔧 Calling setQuality with group: ${bestQuality.group}, name: ${bestQuality.name}`);

                // Reset skip counters
                skippedSwitchCount = 0;
                hasLoggedSkipping = false;
                videoPlayer.setQuality(bestQuality);
                lastSetQualityGroup = bestQuality.group;
                qualitySetForCurrentStream = true;

                // Verify the quality was set
                const expectedQualityName = bestQuality.name;
                const expectedQualityGroup = bestQuality.group;
                setTimeout(() => {
                    const newQuality = videoPlayer.getQuality?.();
                    if (newQuality && newQuality.name) {
                        const success = newQuality.group === expectedQualityGroup;
                        log(`[${Date.now() - lastPageChange}ms] 🔍 Quality after setQuality: ${newQuality.name} (expected: ${expectedQualityName}) ${success ? '✓' : '✗ FAILED'}`);
                    } else {
                        log(`[${Date.now() - lastPageChange}ms] 🔍 Quality after setQuality: empty/invalid ✗ FAILED`);
                    }
                }, 100);

                // Check again 1 second later to make sure it stuck
                setTimeout(() => {
                    const finalQuality = videoPlayer?.getQuality?.();
                    if (finalQuality && finalQuality.name) {
                        if (finalQuality.group !== expectedQualityGroup) {
                            log(`[${Date.now() - lastPageChange}ms] 👀 Quality changed after 1s: now ${finalQuality.name} (was ${expectedQualityName})`);
                        } else {
                            log(`[${Date.now() - lastPageChange}ms] 👀 Quality still ${finalQuality.name} after 1s ✓`);
                        }
                    }
                }, 1000);

                // Reset playback tracking since we're causing a rebuffer
                hasLoggedPlaybackStart = false;
                streamStartedPlayingTime = null;
                return false; // Keep checking
            } else {
                log(`[${timeSincePageChange}ms] ⏸ Waiting to switch (video playing) - will retry when buffering`);
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

        let checkCount = 0;
        let isFastPhase = true;
        const startTime = Date.now();

        function doCheck() {
            checkCount++;
            const elapsed = Date.now() - startTime;

            // Switch to normal checking after fast window
            if (isFastPhase && elapsed >= FAST_CHECK_WINDOW) {
                clearInterval(loadingCheckTimer);
                isFastPhase = false;
                log(`📊 Switched to normal checking after ${checkCount} fast checks in ${elapsed}ms`);

                // Start normal checking for the rest of the window
                const remainingTime = PAGE_CHANGE_WINDOW - elapsed;
                const remainingChecks = Math.ceil(remainingTime / NORMAL_CHECK_INTERVAL);
                let normalCheckCount = 0;

                loadingCheckTimer = setInterval(() => {
                    checkCount++;
                    normalCheckCount++;
                    checkAndSetQuality();

                    if (normalCheckCount >= remainingChecks) {
                        clearInterval(loadingCheckTimer);
                        loadingCheckTimer = null;
                        log(`Checked ${checkCount} times total (${checkCount - normalCheckCount} fast + ${normalCheckCount} normal)`);
                        logTimingSummary();
                    }
                }, NORMAL_CHECK_INTERVAL);
                return;
            }

            checkAndSetQuality();

            // End fast phase if we've exceeded the total window
            if (elapsed >= PAGE_CHANGE_WINDOW) {
                clearInterval(loadingCheckTimer);
                loadingCheckTimer = null;
                log(`Checked ${checkCount} times total (all fast checks)`);
                logTimingSummary();
            }
        }

        function logTimingSummary() {
            if (firstQualityDetectionTime && streamStartedPlayingTime) {
                const qualityDetectedAt = firstQualityDetectionTime - lastPageChange;
                const streamStartedAt = streamStartedPlayingTime - lastPageChange;
                const gapBetween = streamStartedPlayingTime - firstQualityDetectionTime;
                log(`📊 TIMING SUMMARY: Quality detected at ${qualityDetectedAt}ms, Stream started at ${streamStartedAt}ms, Gap: ${gapBetween}ms`);
            } else if (firstQualityDetectionTime && !streamStartedPlayingTime) {
                const qualityDetectedAt = firstQualityDetectionTime - lastPageChange;
                log(`📊 TIMING SUMMARY: Quality detected at ${qualityDetectedAt}ms, Stream never started playing in window`);
            } else if (!firstQualityDetectionTime) {
                log(`📊 TIMING SUMMARY: No qualities detected in window`);
            }
        }

        log(`Starting quality monitoring (${FAST_CHECK_INTERVAL}ms for first ${FAST_CHECK_WINDOW}ms, then ${NORMAL_CHECK_INTERVAL}ms)`);
        loadingCheckTimer = setInterval(doCheck, FAST_CHECK_INTERVAL);
    }

    function handlePageChange() {
        lastPageChange = Date.now();
        videoPlayer = null;
        qualitySetForCurrentStream = false;
        lastSeenQualityCount = 0;
        bestQualityHeight = 0;
        firstQualityDetectionTime = null;
        streamStartedPlayingTime = null;
        hasLoggedPlaybackStart = false;
        lastSetQualityGroup = null;
        skippedSwitchCount = 0;
        hasLoggedSkipping = false;

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
