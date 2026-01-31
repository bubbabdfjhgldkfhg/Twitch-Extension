// ==UserScript==
// @name         Latency
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      3.40
// @description  Set custom latency targets and graph live playback stats
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Latency.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Latency.js
// @match        *://*.twitch.tv/*
// @exclude      *://*.twitch.tv/videos/*
// @exclude      *://*.twitch.tv/*/clip/*
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/chart.js
// ==/UserScript==

// =============================================================================
// ULTRA LOW LATENCY TWITCH EXTENSION
// =============================================================================
//
// This script dynamically adjusts video playback speed to maintain a target
// latency while avoiding buffer underruns. It displays a real-time graph of
// stream statistics and provides keyboard controls for manual latency adjustment.
//
// KEY FEATURES:
// - Automatically adjusts playback speed to reach/maintain target latency
// - Displays live graph showing latency, buffer, FPS, and bitrate
// - Keyboard controls: '[' to increase target, ']' to decrease target
// - Per-channel latency settings (remembered during session)
// - Buffer health monitoring with automatic recovery actions
//
// SPEED ADJUSTMENT BEHAVIOR:
// - When latency > target: speeds up playback to catch up
// - When latency < target: slows down playback (down to SPEED_MIN)
// - Max speed is proportional to buffer headroom above MINIMUM_BUFFER
//   - Buffer at minimum → max speed = 1.0x (can't afford to speed up)
//   - Buffer with full headroom → max speed = SPEED_MAX (1.15x)
// - This self-limiting approach prevents buffer drain without hard caps
//
// RESET EVENTS (blue bars in graph):
// - Indicate buffer health issues (visual indicator only)
// - Not shown when at minimum latency (0.75s) since user knows they're on edge
// =============================================================================

(function() {
    'use strict';

    // =========================================================================
    // CONFIGURATION - Polling & Graph Display
    // =========================================================================
    let MAIN_POLLING_INTERVAL = 250; // Milliseconds between each update tick
    let DESIRED_HISTORY_LENGTH = 15; // Seconds of history to show in graph
    let MAX_DATA_POINTS = (DESIRED_HISTORY_LENGTH*1000) / MAIN_POLLING_INTERVAL;
    MAX_DATA_POINTS = parseFloat(MAX_DATA_POINTS.toFixed(0));

    let GRAPH_WIDTH = '210px';
    let GRAPH_HEIGHT = '40px';
    let GRAPH_LINE_THICKNESS = 2.0;
    let NUMBER_COLOR_OPACITY_TRANSITION_DURATION = 300; // ms

    // =========================================================================
    // CONFIGURATION - Latency Targets
    // =========================================================================
    let latencyTargetLow = 0.75;    // Default target for low latency streams
    let latencyTargetNormal = 4.00; // Default target for normal latency streams
    let unstableBufferSeparationLowLatency = 2;   // Max allowed buffer-latency gap (low latency)
    let unstableBufferSeparationNormalLatency = 10; // Max allowed buffer-latency gap (normal)
    let UNSTABLE_BUFFER_SEPARATION; // Active threshold (set based on stream type)
    let MINIMUM_BUFFER = 0.75;      // Absolute minimum buffer (used for problem detection)
    let TARGET_LATENCY;             // Current target latency (dynamically set)
    let LATENCY_SETTINGS = {};      // Per-channel latency settings {pathname: target}
    let TARGET_LATENCY_MIN = 0.50;  // Absolute minimum latency target allowed
    let TARGET_LATENCY_TOLERANCE = 0.13; // Latency jitter to ignore before adjusting speed
    let NUM_LATENCY_VALS_TO_AVG = 3;     // Number of latency samples to average for smoothing

    // =========================================================================
    // CONFIGURATION - Speed Adjustment
    // =========================================================================
    let SPEED_ADJUSTMENT_FACTOR_DEFAULT = 7.2; // Higher = gentler speed changes
    let SPEED_ADJUSTMENT_FACTOR = SPEED_ADJUSTMENT_FACTOR_DEFAULT;
    let SPEED_MIN = 0.85;  // Minimum playback speed (slow down limit)
    let SPEED_MAX = 1.15;  // Maximum playback speed (speed up limit)
    let BUFFER_HEADROOM_FOR_FULL_SPEED = 1.0;  // Buffer margin above target buffer (TARGET_LATENCY - 0.25) needed for SPEED_MAX
    let NUM_BUFFER_VALS_TO_AVG = 15;  // Number of buffer samples to average for speed calc

    // =========================================================================
    // STATE - Playback Initialization
    // =========================================================================
    let waitingForStreamPlayback = true;      // True until stream starts playing
    const playbackStateCheckCooldown = 1500;  // Delay before checking playback state
    let playbackStateCheckTimerId = null;
    let playbackStateCheckReady = false;

    // =========================================================================
    // STATE - Problem Detection & Recovery
    // =========================================================================
    let LATENCY_PROBLEM = false;        // True when buffer is unhealthy
    let LAST_LATENCY_PROBLEM;           // Timestamp of last detected problem
    let FPS_PROBLEM = false;            // True when FPS drops to 0
    let PREV_FPS_PROBLEM = false;       // Previous tick's FPS problem state
    let LATENCY_PROBLEM_COOLDOWN = 180000; // 3 min - auto-lower target if no problems
    let SEEK_COOLDOWN = false;          // Prevents repeated seek-back attempts
    let SEEK_BACKWARD_SECONDS = 1.25;   // How far to seek back on buffer issues

    // =========================================================================
    // STATE - Reset Events (Blue Bars in Graph)
    // =========================================================================
    // pendingResetEvent serves two purposes:
    // 1. Shows a blue vertical bar in the graph to indicate a buffer issue occurred
    // 2. Caps playback speed at 1x to prevent further buffer drain
    //
    // IMPORTANT: This flag is reset to false at the end of each tick in updateGraph().
    // This means the speed cap is automatically released on the very next tick if the
    // buffer is healthy (i.e., recordResetEvent() is not called again). This prevents
    // a brief hiccup from forcing 3+ minutes of above-target latency.
    //
    // At minimum latency (0.75s), reset events are not recorded since:
    // - User can't lower the target any further
    // - Showing blue bars would be pointless
    // - We want to maintain lowest possible latency even with some risk
    let pendingResetEvent = false;

    // =========================================================================
    // STATE - Buffering Detection
    // =========================================================================
    let BUFFER_COUNT = 0;       // Consecutive ticks in Buffering state
    let MAX_BUFFER_COUNT = 20;  // Trigger recovery after this many ticks
    let BUFFER_STATE;           // 'Filling' or 'Draining'

    let READY_COUNT = 0;        // Consecutive ticks in Ready state (stuck)
    let MAX_READY_COUNT = 20;   // Trigger recovery after this many ticks

    // =========================================================================
    // STATE - Player References
    // =========================================================================
    let playbackRate = 1.0;     // Current playback speed
    let videoPlayer;            // Twitch video player instance
    let PLAYER_STATE;           // Current player state (Playing, Buffering, etc.)
    let PREVIOUS_PLAYER_STATE;  // Previous tick's player state

    let screenElement = {
        videoContainer: { node: null, className: 'video-player__overlay' },
        currentLatency: {
            node: null, className: 'current-latency-text',
            topValue: 'max(0px, calc((100vh - 56.25vw) / 2))',
            opacity: { default: '.4', current: '.4', peak: '1' }
        },
        targetLatency: {
            node: null, className: 'target-latency-text',
            topValue: 'max(20px, calc((100vh - 56.25vw) / 2) + 18px)',
            opacity: { timer: null, duration: 1500, default: '0', current: '0', peak: '1' }
        },
        graph: {
            node: null, className: 'stream-stats-graph',
            opacity: { timer: null, duration: 5000, default: '0', current: '0', peak: '1' }
        }
    }

    let latencyData = { latest: null, prev: null, history: [] };
    let bufferData = { latest: null, prev: null, history: [] };

    const graphValues = { smoothedLatency: null, smoothedBufferSize: null, latestFps: null, latestBitrate: null };

    // Graph setup
    const canvas = document.createElement('canvas');
    canvas.width = GRAPH_WIDTH;
    canvas.height = GRAPH_HEIGHT;

    const ctx = canvas.getContext('2d');
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'Latency', borderColor: 'orange', borderWidth: GRAPH_LINE_THICKNESS, data: [], pointRadius: 0, yAxisID: 'latency' },
                { label: 'Buffer Size', borderColor: 'red', borderWidth: GRAPH_LINE_THICKNESS, data: [], pointRadius: 0, yAxisID: 'latency' },
                { label: 'FPS', borderColor: 'yellow', borderWidth: GRAPH_LINE_THICKNESS, data: [], pointRadius: 0, yAxisID: 'frames' },
                { label: 'Bitrate', borderColor: 'white', borderWidth: GRAPH_LINE_THICKNESS, data: [], pointRadius: 0, yAxisID: 'bitrate' },
                { label: 'Reset', type: 'bar', backgroundColor: 'rgba(0, 255, 255, 0.85)', data: [], yAxisID: 'reset', barPercentage: 0.5 }
            ]
        },
        options: {
            animation: {
                duration: MAIN_POLLING_INTERVAL,
                x: { type: 'number', easing: 'linear', duration: MAIN_POLLING_INTERVAL },
                y: { duration: 0 }
            },
            scales: {
                'latency': { beginAtZero: false, min: 0.25, display: false },
                'frames': { beginAtZero: true, display: false },
                'bitrate': { type: 'logarithmic', beginAtZero: true, display: false },
                'reset': { beginAtZero: true, max: 1, display: false },
                x: { display: false }
            },
            plugins: { legend: { display: false } }
        }
    });

    // =========================================================================
    // recordResetEvent - Record a buffer health issue
    // =========================================================================
    // Called when buffer problems are detected (buffer too low, buffer-latency
    // mismatch, or FPS drop). Shows a blue vertical bar in the graph and raises
    // the minimum buffer threshold for this channel to prevent future issues.
    //
    // Note: Speed limiting is handled by buffer-proportional max speed in
    // evaluateSpeedAdjustment(). Blue bars are hidden at minimum latency.
    // =========================================================================
    function recordResetEvent() {
        pendingResetEvent = true;
    }


    // =========================================================================
    // setSpeed - Apply playback rate to all media elements
    // =========================================================================
    // Overrides the native playbackRate property to maintain control over speed.
    // This prevents Twitch's player from resetting our speed adjustments.
    // =========================================================================
    function setSpeed(newRate) {
        // return; // Uncomment to test script without interfering with speed

        if (playbackRate == newRate) return;
        playbackRate = newRate;

        const mediaElements = document.querySelectorAll('video, audio');
        mediaElements.forEach(media => {
            // Override playbackRate property if not already done
            if (!media._rateControlApplied) {
                const nativeSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate').set;
                Object.defineProperty(media, 'playbackRate', {
                    set: () => nativeSetter.call(media, playbackRate),
                    get: () => playbackRate
                });
                media._rateControlApplied = true;
            }
            media.playbackRate = playbackRate;
        });
    }

    // =========================================================================
    // Keyboard Controls
    // =========================================================================
    // '[' key: Increase target latency by 0.25s (more buffer room, less aggressive)
    // ']' key: Decrease target latency by 0.25s (lower latency, more aggressive)
    // =========================================================================
    document.addEventListener("keydown", async function(event) {
        // Ignore when typing in input fields
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable) return;

        switch (event.key) {
            case '[':
                event.preventDefault();
                changeTargetLatency(0.25);  // Increase target (safer)
                break;
            case ']':
                event.preventDefault();
                changeTargetLatency(-0.25); // Decrease target (lower latency)
                break;
        }
    });

    function changeTargetLatency(delta) {
        if (waitingForStreamPlayback) {
            return;
        }
        if (isNaN(delta) || !delta || delta == -Infinity || isNaN(TARGET_LATENCY) || !TARGET_LATENCY) {
            return;
        }
        if (TARGET_LATENCY + delta < TARGET_LATENCY_MIN) {
            return;
        }

        TARGET_LATENCY += delta;

        // Save the pathname and TARGET_LATENCY to the dictionary
        let pathname = window.location.pathname;
        LATENCY_SETTINGS[pathname] = TARGET_LATENCY;

        updateLatencyTextElement('target-latency-text', TARGET_LATENCY);
        temporarilyShowElement(screenElement.targetLatency);
    }

    function temporarilyShowElement(element) {
        if (!element.node) return;
        element.node.style.opacity = element.opacity.peak;
        if (element.opacity.timer) clearTimeout(element.opacity.timer);
        element.opacity.timer = setTimeout(() => {
            element.node.style.opacity = element.opacity.current;
        }, element.opacity.duration);
    }

    function attachMouseHoverListeners(element) {
        element.addEventListener('mouseenter', () => {
            screenElement.currentLatency.opacity.current = screenElement.currentLatency.opacity.peak;
            screenElement.targetLatency.opacity.current = screenElement.currentLatency.opacity.peak;
            screenElement.graph.opacity.current = screenElement.graph.opacity.peak;
            try {
                screenElement.currentLatency.node.style.opacity = screenElement.currentLatency.opacity.peak;
                screenElement.targetLatency.node.style.opacity = screenElement.targetLatency.opacity.peak;
                screenElement.graph.node.style.opacity = screenElement.graph.opacity.peak;
            } catch (e) {
                console.log('Couldn\'t set opacity:', e);
            }
        });

        element.addEventListener('mouseleave', () => {
            screenElement.currentLatency.opacity.current = screenElement.currentLatency.opacity.default;
            screenElement.targetLatency.opacity.current = screenElement.targetLatency.opacity.default;
            screenElement.graph.opacity.current = screenElement.graph.opacity.default;
            try {
                screenElement.currentLatency.node.style.opacity = screenElement.currentLatency.opacity.default;
                screenElement.targetLatency.node.style.opacity = screenElement.targetLatency.opacity.default;
                screenElement.graph.node.style.opacity = screenElement.graph.opacity.default;
            } catch (e) {
                console.log('Couldn\'t set opacity:', e);
            }
        });
    }

    // Function to create a new latency text element with the specified class name and top value
    function createLatencyTextElement(className, opacity, topValue) {
        let newElement = document.querySelector(`.${className}`);
        if (newElement) return newElement;

        newElement = document.createElement('div');
        newElement.classList.add(className);
        newElement.setAttribute(
            'style',
            `transition: color ${NUMBER_COLOR_OPACITY_TRANSITION_DURATION}ms, opacity ${NUMBER_COLOR_OPACITY_TRANSITION_DURATION}ms !important;
             position: absolute;
             right: 0;
             top: ${topValue};
             text-align: right;
             color: white;
             padding-right: 0.5rem;
             font-size: 1.25rem;
             opacity: ${opacity};`
        );
        screenElement.videoContainer.node = document.querySelector(`.${screenElement.videoContainer.className}`);
        screenElement.videoContainer.node.appendChild(newElement);

        attachMouseHoverListeners(newElement);

        return newElement;
    }

    // Function to update an existing latency text element with new inner text
    function updateLatencyTextElement(className, innerText) {
        if (!innerText || isNaN(innerText)) return;

        const latencyElement = document.querySelector(`.${className}`);
        if (latencyElement) latencyElement.innerText = `${innerText.toFixed(2)}s`;
    }

    // Plot the video stats values
    function appendGraph() {
        if (!screenElement.videoContainer.node) {
            screenElement.videoContainer.node = document.querySelector(`.${screenElement.videoContainer.className}`)
        }
        let videoContainer = screenElement.videoContainer.node;
        let streamStatsGraph = videoContainer.querySelector(`.${screenElement.graph.className}`);
        if (streamStatsGraph) return;

        streamStatsGraph = document.createElement('div');
        streamStatsGraph.classList.add(screenElement.graph.className);
        streamStatsGraph.setAttribute(
            'style',
            `transition: opacity 0.5s !important;
             position: absolute;
             right: 50px;
             top: max(0px, calc((100vh - 56.25vw) / 2));
             opacity: 0;
             width: ${GRAPH_WIDTH};
             height: ${GRAPH_HEIGHT};
             text-align: -webkit-right;`
        );
        videoContainer.appendChild(streamStatsGraph);
        streamStatsGraph.appendChild(canvas);
        // Show stats graph when hovered
        attachMouseHoverListeners(streamStatsGraph);
        // Fill new graph with empty data so it doesnt stretch across the screen
        chart.data.datasets.forEach(dataset => {
            dataset.data = Array(MAX_DATA_POINTS).fill(null)
        });
        chart.data.labels = Array(MAX_DATA_POINTS).fill(null);
        // Add node to config
        screenElement.graph.node = streamStatsGraph;
    }

    // =========================================================================
    // updateGraph - Push new data points to the chart
    // =========================================================================
    // Called at end of each tick to update the visual graph with latest stats.
    //
    // IMPORTANT: This function resets pendingResetEvent to false after pushing
    // the bar data. This is what allows the speed cap to be released on the next
    // tick if buffer is healthy - evaluateSpeedAdjustment() checks pendingResetEvent
    // and if it's false (because recordResetEvent wasn't called this tick), it
    // allows speed to exceed 1x again.
    // =========================================================================
    function updateGraph() {
        // Remove oldest data point if at max capacity
        if (chart.data.labels.length >= MAX_DATA_POINTS) {
            chart.data.datasets.forEach(dataset => dataset.data.shift());
            chart.data.labels.shift();
        }

        // Push new data points
        chart.data.labels.push(new Date().toLocaleTimeString());
        chart.data.datasets[0].data.push(graphValues.smoothedLatency);  // Orange line
        chart.data.datasets[1].data.push(graphValues.smoothedBufferSize); // Red line
        chart.data.datasets[2].data.push(graphValues.latestFps);        // Yellow line
        chart.data.datasets[3].data.push(graphValues.latestBitrate);    // White line
        // Blue bar (reset event) - hidden at minimum latency since user knows they're on the edge
        let showResetBar = pendingResetEvent && TARGET_LATENCY > TARGET_LATENCY_MIN;
        chart.data.datasets[4].data.push(showResetBar ? 1 : null);

        // Reset flag for next tick
        pendingResetEvent = false;

        chart.update();
    }

    function isValidDataPoint(statObject) {
        return statObject.latest && !isNaN(statObject.latest) && statObject.latest != statObject.prev;
    }

    function twoDecimalPlaces(float) {
        return parseFloat(float.toFixed(2));
    }

    function handleLatencyChange() {
        if (!isValidDataPoint(latencyData)) return;
        // Smooth latency by averaging latest values
        latencyData.prev = latencyData.latest;
        latencyData.history.push(latencyData.latest);
        if (latencyData.history.length > NUM_LATENCY_VALS_TO_AVG) latencyData.history.shift();
        // console.log(latencyData.history);
        graphValues.smoothedLatency = latencyData.history.reduce((sum, value) => sum + value, 0) / latencyData.history.length;
    }

    function handleBufferSizeChange() {
        if (!isValidDataPoint(bufferData)) return;

        bufferData.prev = bufferData.latest;
        // Temporary solution to big spikes
        if (bufferData.latest < (latencyData.latest + 10)) {
            graphValues.smoothedBufferSize = bufferData.latest;
        }

        // Track buffer history for averaged buffer health calculation
        bufferData.history.push(bufferData.latest);
        if (bufferData.history.length > NUM_BUFFER_VALS_TO_AVG) bufferData.history.shift();
    }

    // =========================================================================
    // estimateLatency - Analyze buffer health and return best latency estimate
    // =========================================================================
    // Examines the relationship between reported latency and buffer size to
    // determine the actual latency and detect buffer health issues.
    //
    // Buffer issues trigger recordResetEvent() which:
    // - Shows blue bar in graph
    // - Caps speed at 1x (released next tick if healthy)
    //
    // Also auto-lowers target latency if no problems for 3 min
    // =========================================================================
    function estimateLatency(latestLatency, latestBuffer) {
        if (latestLatency == null || latestBuffer == null || isNaN(latestLatency) || isNaN(latestBuffer)) return;

        let now = Date.now();

        // Auto-lower target latency if stream has been stable for 3+ minutes
        if (LAST_LATENCY_PROBLEM && now - LAST_LATENCY_PROBLEM > LATENCY_PROBLEM_COOLDOWN) {
            changeTargetLatency(-0.25);
            LAST_LATENCY_PROBLEM = now;
        }

        // CASE 1: Buffer larger than latency (unusual but possible)
        if (latestBuffer > latestLatency + UNSTABLE_BUFFER_SEPARATION) {
            LATENCY_PROBLEM = false;
            return latestBuffer; // Use buffer as more accurate estimate
        }

        // CASE 2: Buffer too far below latency (buffer draining fast)
        else if (latestBuffer < latestLatency - UNSTABLE_BUFFER_SEPARATION && latestLatency < 30) {
            LATENCY_PROBLEM = true;
            LAST_LATENCY_PROBLEM = now;
            recordResetEvent();
            return latestLatency;
        }

        // CASE 3: Buffer critically low (below default threshold)
        else if (latestBuffer < MINIMUM_BUFFER) {
            // Buffer dangerously low - likely to cause buffering soon
            LAST_LATENCY_PROBLEM = now;
            recordResetEvent();

            // if (LATENCY_PROBLEM_COUNTER >= MAX_LATENCY_PROBLEMS && !SEEK_COOLDOWN) {
            //     // Go back a couple seconds to avoid buffering and raise target latency
            //     videoPlayer?.seekTo(videoPlayer?.getPosition() - 1.5);
            //     console.log('Seeking backwards');
            //     changeTargetLatency(0.25)

            // // SEEK_COOLDOWN can only be reset if BUFFER_STATE changes to Filling so we don't get caught in a loop.
            // SEEK_COOLDOWN = true;
            // LATENCY_PROBLEM = true;
            // LATENCY_PROBLEM_COUNTER = 0;
            // // Return a number that doesnt mess with the speed.
            // return TARGET_LATENCY;

            // } else if (LATENCY_PROBLEM_COUNTER >= MAX_LATENCY_PROBLEMS && SEEK_COOLDOWN) {
            //     // We already tried seeking backwards and buffer issue persists
            //     console.log('Buffer still draining: PAUSE/PLAY');
            //     videoPlayer?.pause();
            //     videoPlayer?.play();

            //     LATENCY_PROBLEM = true;
            //     LATENCY_PROBLEM_COUNTER = 0;
            //     // Return a number that doesnt mess with the speed.
            //     return TARGET_LATENCY;
            // }

            // Return latency (not buffer) to avoid overcorrecting speed
            return latestLatency;
        }

        // CASE 4: Buffer is healthy
        else {
            LATENCY_PROBLEM = false;
            return latestLatency;
        }
    }

    // =========================================================================
    // evaluateSpeedAdjustment - Calculate and apply playback speed
    // =========================================================================
    // Adjusts playback speed based on how far current latency is from target.
    // Speed is proportional to the latency delta - larger gaps = faster adjustment.
    //
    // BUFFER-PROPORTIONAL MAX SPEED:
    // Instead of a hard cap when buffer issues are detected, max speed scales
    // smoothly based on buffer headroom above target buffer (TARGET_LATENCY - 0.25):
    //   - Buffer at minimum (0.75s) → max speed = 1.0x (can't afford to speed up)
    //   - Buffer with full headroom → max speed = SPEED_MAX (1.15x)
    //
    // This self-limiting approach means we only speed up as much as buffer allows,
    // preventing drain without reactive hard caps that cause latency to spike.
    // =========================================================================
    function evaluateSpeedAdjustment(latencyEstimate) {
        if (!latencyEstimate || isNaN(latencyEstimate)) return;

        // Calculate how far we are from target (positive = too high, need to speed up)
        let latencyDelta = latencyEstimate - TARGET_LATENCY;

        // Only adjust if delta exceeds tolerance threshold (avoids jitter)
        if (Math.abs(latencyDelta) >= TARGET_LATENCY_TOLERANCE) {
            let newSpeed = ((latencyDelta / SPEED_ADJUSTMENT_FACTOR) + 1);

            // Buffer-proportional max speed: only speed up as much as buffer can afford
            // Use averaged buffer for smoother speed adjustments
            // bufferMargin: how much buffer we have above the minimum (0 = at minimum)
            // bufferHealth: normalized 0-1 (0 = no headroom, 1 = full headroom)
            // maxSpeed: scales from 1.0 (no headroom) to SPEED_MAX (full headroom)
            let avgBuffer = bufferData.history.length > 0
                ? bufferData.history.reduce((sum, val) => sum + val, 0) / bufferData.history.length
                : bufferData.latest;
            avgBuffer = avgBuffer.toFixed(2);

            let targetBuffer = Math.max(TARGET_LATENCY - 0.25, MINIMUM_BUFFER);
            let bufferMargin = Math.max(0, avgBuffer - targetBuffer);
            let bufferHealth = Math.min(1, bufferMargin / BUFFER_HEADROOM_FOR_FULL_SPEED);
            let maxSpeed = 1 + (SPEED_MAX - 1) * bufferHealth;

            let finalSpeed = Math.min(Math.max(newSpeed, SPEED_MIN), maxSpeed).toFixed(2);
            setSpeed(finalSpeed);

            // console.log('avgBuf:Speed', avgBuffer, finalSpeed);

        } else {
            // Within tolerance - use normal 1x speed
            setSpeed(1);
        }
    }

    function resetPlaybackStateCheck() {
        playbackStateCheckReady = false;
        if (playbackStateCheckTimerId) {
            clearTimeout(playbackStateCheckTimerId);
        }
        playbackStateCheckTimerId = setTimeout(() => {
            playbackStateCheckTimerId = null;
            playbackStateCheckReady = true;
        }, playbackStateCheckCooldown);
    }

    function handlePageChange() {
        LAST_LATENCY_PROBLEM = Date.now();

        waitingForStreamPlayback = true;
        resetPlaybackStateCheck();

        // Don't carry over residual speed from last channel
        setSpeed(1);
        // First few latency values on page load can't be trusted
        latencyData.latest = null;
        latencyData.history = [];
        bufferData.latest = null;
        latencyData.prev = null;
        bufferData.prev = null;
        graphValues.smoothedLatency = null;
        graphValues.smoothedBufferSize = null;
        // Assume a new video player instance was created
        videoPlayer = null;
        PREVIOUS_PLAYER_STATE = null;
        // Reset event tracking
        pendingResetEvent = false;
        PREV_FPS_PROBLEM = false;
    }

    function isStreamPlaying() {
        const state = videoPlayer?.getState?.();
        return state === 'Playing';
    }

    function setLatencyTextColor(latencyTextElement) {
        if (!latencyTextElement.node || !bufferData.latest || !latencyData.latest) return;

        // Check for FPS drop to 0
        FPS_PROBLEM = graphValues.latestFps === 0;

        // Reset timer on FPS drop (only on transition to problem state)
        if (FPS_PROBLEM && !PREV_FPS_PROBLEM) {
            LAST_LATENCY_PROBLEM = Date.now();
            recordResetEvent();
        }
        PREV_FPS_PROBLEM = FPS_PROBLEM;

        if (bufferData.latest > latencyData.latest + UNSTABLE_BUFFER_SEPARATION) {
            // latencyTextElement.node.style.color = 'orange';
            // latencyTextElement.node.style.opacity = '.8';
        } else if (LATENCY_PROBLEM || FPS_PROBLEM) {
            latencyTextElement.node.style.color = 'red';
            latencyTextElement.node.style.opacity = '1';
            temporarilyShowElement(screenElement.graph);
        } else {
            latencyTextElement.node.style.color = 'white';
            // Go to back to whatever opacity it was before
            latencyTextElement.node.style.opacity = latencyTextElement.opacity.current;
        }
    }

    function getLatestVideoStats() {
        let pathname = window.location.pathname;
        if (LATENCY_SETTINGS[pathname]) {
            TARGET_LATENCY = LATENCY_SETTINGS[pathname];
        } else {
            TARGET_LATENCY = videoPlayer?.isLiveLowLatency() ? latencyTargetLow : latencyTargetNormal;
        }
        UNSTABLE_BUFFER_SEPARATION = videoPlayer?.isLiveLowLatency() ? unstableBufferSeparationLowLatency : unstableBufferSeparationNormalLatency;
        latencyData.latest = twoDecimalPlaces(videoPlayer?.getLiveLatency());
        bufferData.latest = twoDecimalPlaces(videoPlayer?.getBufferDuration());
        graphValues.latestBitrate = Math.round(videoPlayer?.getVideoBitRate()/1000);
        graphValues.latestFps = videoPlayer?.getVideoFrameRate();

        if ((videoPlayer?.getBuffered()?.end - videoPlayer?.getBufferedRanges()?.video[0]?.end) > 0) {
            BUFFER_STATE = 'Filling';
            SEEK_COOLDOWN = false;
            // DRAIN_COUNT = 0;
        } else {
            BUFFER_STATE ='Draining';
            // DRAIN_COUNT += 1;
        }
        // console.log(BUFFER_STATE);

        // Doesnt work on normal latency streams
        // if (DRAIN_COUNT >= MAX_DRAIN_COUNT) {
        //     videoPlayer?.pause();
        //     videoPlayer?.play();
        //     changeTargetLatency(0.25)
        //     DRAIN_COUNT = 0;
        //     console.log('MAX_DRAIN_COUNT: PAUSE/PLAY');
        // }
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

    //     // DO NOT DELETE

    //     function inspectVideoPlayer(player) {
    //         if (!player) {
    //             console.log('Video player not found');
    //             return;
    //         }

    //         // Get all properties including methods
    //         let properties = new Set();
    //         let proto = Object.getPrototypeOf(player);

    //         // Walk up the prototype chain
    //         while (proto && proto !== Object.prototype) {
    //             const props = Object.getOwnPropertyNames(proto)
    //             .filter(prop => typeof player[prop] === 'function'); // Only get methods
    //             props.forEach(prop => properties.add(prop));
    //             proto = Object.getPrototypeOf(proto);
    //         }

    //         // Sort and log all available methods
    //         console.log('Available video player methods:');
    //         [...properties].sort().forEach(prop => {
    //             try {
    //                 console.log(`${prop}() - Type: ${typeof player[prop]}`);
    //             } catch (e) {
    //                 console.log(`${prop}() - Unable to access`);
    //             }
    //         });
    //     }

    function stuckBuffering() {
        PLAYER_STATE = videoPlayer?.getState();

        if (PREVIOUS_PLAYER_STATE != PLAYER_STATE) {
            console.log(`PLAYER_STATE: ${PLAYER_STATE}`);
        }

        if (PLAYER_STATE == 'Buffering' && PREVIOUS_PLAYER_STATE == 'Playing' && !SEEK_COOLDOWN) {
            videoPlayer?.seekTo(videoPlayer?.getPosition() - SEEK_BACKWARD_SECONDS);
            changeTargetLatency(0.25);
            SEEK_COOLDOWN = true;
            // SEEK_COOLDOWN can only be set to false if BUFFER_STATE = 'Filling'. That's how we know.
        } else if (PLAYER_STATE == 'Buffering' && PREVIOUS_PLAYER_STATE == 'Playing' && SEEK_COOLDOWN) {
            videoPlayer?.pause();
            videoPlayer?.play();
            changeTargetLatency(-0.25); // Undo the latency change because that wasn't the issue.
            SEEK_COOLDOWN = false;
            console.log('Buffer still draining: PAUSE/PLAY');
        }

        PREVIOUS_PLAYER_STATE = PLAYER_STATE;

        if (PLAYER_STATE == 'Buffering') {
            BUFFER_COUNT += 1;
            if (BUFFER_COUNT >= MAX_BUFFER_COUNT) {
                console.log('Buffering too long: PAUSE/PLAY');
                videoPlayer?.pause();
                videoPlayer?.play();
                BUFFER_COUNT = 0;
                return true;
            }
        } else {
            BUFFER_COUNT = 0;
        }

        // Sometimes PAUSE/PLAY will cause the player to get stuck in Ready state.
        if (PLAYER_STATE == 'Ready') {
            READY_COUNT += 1;
            if (READY_COUNT >= MAX_READY_COUNT) {
                console.log('Ready too long: PAUSE/PLAY');
                videoPlayer?.pause();
                videoPlayer?.play();
                READY_COUNT = 0;
                return true;
            }
        } else {
            READY_COUNT = 0;
        }
    }

    // Update graph & make sure table is open
    resetPlaybackStateCheck();

    let pollingInterval = setInterval(async function() {

        // We can't use this cause stuckBuffering() won't run.
        // if (PAUSE_PLAY_COOLDOWN) {
        //     return;
        // }

        videoPlayer = videoPlayer ?? findReactNode(findReactRootNode(), node =>
                                                   node.setPlayerActive && node.props && node.props.mediaPlayerInstance)?.props.mediaPlayerInstance;

        if (waitingForStreamPlayback) {
            if (!videoPlayer) {
                return;
            }

            if (!playbackStateCheckReady) {
                return;
            }

            if (!isStreamPlaying()) {
                return;
            }

            waitingForStreamPlayback = false;
            playbackStateCheckReady = false;
        }

        // let proto = Object.getPrototypeOf(videoPlayer?.getHTMLVideoElement());
        // while (proto) {
        //     console.log(Object.getOwnPropertyNames(proto));
        //     proto = Object.getPrototypeOf(proto);
        // }
        // videoPlayer.getHTMLVideoElement().preservesPitch = false;

        // // DO NOT DELETE
        // if (videoPlayer && !videoPlayer._methodsLogged) {
        //     inspectVideoPlayer(videoPlayer);
        //     videoPlayer._methodsLogged = true; // Only log once
        // }

        // videoPlayer?.setLogLevel('debug');

        if (stuckBuffering()) return;

        screenElement.currentLatency.node = createLatencyTextElement(
            screenElement.currentLatency.className,
            screenElement.currentLatency.opacity.default,
            screenElement.currentLatency.topValue);
        screenElement.targetLatency.node = createLatencyTextElement(
            screenElement.targetLatency.className,
            screenElement.targetLatency.opacity.default,
            screenElement.targetLatency.topValue
        );
        updateLatencyTextElement(screenElement.targetLatency.className, TARGET_LATENCY);

        getLatestVideoStats();
        handleLatencyChange();
        handleBufferSizeChange();

        let latencyEstimate = estimateLatency(graphValues.smoothedLatency, graphValues.smoothedBufferSize)

        updateLatencyTextElement(screenElement.currentLatency.className, latencyEstimate);
        setLatencyTextColor(screenElement.currentLatency);

        evaluateSpeedAdjustment(latencyEstimate);
        appendGraph();
        updateGraph();

    }, MAIN_POLLING_INTERVAL);

    // Enhance navigation handling by overriding history methods.
    (function(history){
        const overrideHistoryMethod = (methodName) => {
            const original = history[methodName];
            history[methodName] = function(state) {
                const result = original.apply(this, arguments);
                handlePageChange();
                return result;
            };
        };
        overrideHistoryMethod('pushState');
        overrideHistoryMethod('replaceState');
    })(window.history);
    window.addEventListener('popstate', handlePageChange);
})();
