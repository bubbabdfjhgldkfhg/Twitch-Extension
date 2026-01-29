// ==UserScript==
// @name         Latency
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      3.18
// @description  Set custom latency targets and graph live playback stats
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Latency.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Latency.js
// @match        *://*.twitch.tv/*
// @exclude      *://*.twitch.tv/videos/*
// @exclude      *://*.twitch.tv/*/clip/*
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/chart.js
// ==/UserScript==


(function() {
    'use strict';

    let MAIN_POLLING_INTERVAL = 250; // Milliseconds
    let DESIRED_HISTORY_LENGTH = 15; // Seconds
    let MAX_DATA_POINTS = (DESIRED_HISTORY_LENGTH*1000) / MAIN_POLLING_INTERVAL;
    MAX_DATA_POINTS = parseFloat(MAX_DATA_POINTS.toFixed(0));

    let GRAPH_WIDTH = '210px';
    let GRAPH_HEIGHT = '40px';
    let GRAPH_LINE_THICKNESS = 2.0;
    let NUMBER_COLOR_OPACITY_TRANSITION_DURATION = 300; // ms

    let latencyTargetLow = 1.00; // Low latency default
    let latencyTargetNormal = 4.00; // Normal latency default
    let unstableBufferSeparationLowLatency = 2; // Low latency default
    let unstableBufferSeparationNormalLatency = 10; // Normal latency default
    let UNSTABLE_BUFFER_SEPARATION; // Buffer shouldn't be this far below latency
    let MINIMUM_BUFFER = 0.75;
    let TARGET_LATENCY;
    let LATENCY_SETTINGS = {}; // Dictionary to store pathname and target latency
    let TARGET_LATENCY_MIN = 0.75;
    let TARGET_LATENCY_TOLERANCE = 0.13; // Latency jitter to ignore
    let NUM_LATENCY_VALS_TO_AVG = 3; // Average the previous x latencies together
    let SPEED_ADJUSTMENT_FACTOR_DEFAULT = 7.2; // Lower number is more aggresive
    let SPEED_ADJUSTMENT_FACTOR = SPEED_ADJUSTMENT_FACTOR_DEFAULT;
    let SPEED_MIN = 0.07;
    let SPEED_MAX = 1.15;

    let waitingForStreamPlayback = true;
    const playbackStateCheckCooldown = 1500;
    let playbackStateCheckTimerId = null;
    let playbackStateCheckReady = false;

    let LATENCY_PROBLEM = false;
    // let LATENCY_PROBLEM_COUNTER = 0;
    // let MAX_LATENCY_PROBLEMS = 3;
    let LAST_LATENCY_PROBLEM;
    let FPS_PROBLEM = false;
    let PREV_FPS_PROBLEM = false;
    let pendingResetEvent = false;
    let LATENCY_PROBLEM_COOLDOWN = 180000; // 3 minutes in ms
    let SEEK_COOLDOWN = false;
    let SEEK_BACKWARD_SECONDS = 1.25;

    let BUFFER_COUNT = 0;
    let MAX_BUFFER_COUNT = 20;
    let BUFFER_STATE;

    let READY_COUNT = 0;
    let MAX_READY_COUNT = 20;

    let playbackRate = 1.0;
    let videoPlayer;
    let PLAYER_STATE;
    let PREVIOUS_PLAYER_STATE;

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

    function recordResetEvent() {
        // Don't show reset bars if already at minimum latency target
        if (TARGET_LATENCY <= TARGET_LATENCY_MIN) return;
        // No point accelerating playback when buffer is running low
        if (playbackRate > 1) setSpeed(1);
        pendingResetEvent = true;
    }

    function setSpeed(newRate) {
        // return; // Test script without interfering with speed

        if (playbackRate == newRate) return;
        playbackRate = newRate;
        // console.log('playbackRate', playbackRate);
        const mediaElements = document.querySelectorAll('video, audio');
        mediaElements.forEach(media => {
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

    // Listener for adjusting stream speed
    document.addEventListener("keydown", async function(event) {
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable) return;

        switch (event.key) {
            case '[':
                event.preventDefault();
                changeTargetLatency(0.25);
                break;
            case ']':
                event.preventDefault();
                changeTargetLatency(-0.25);
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

    function updateGraph() {
        if (chart.data.labels.length >= MAX_DATA_POINTS) {
            chart.data.datasets.forEach(dataset => dataset.data.shift());
            chart.data.labels.shift();
        }

        chart.data.labels.push(new Date().toLocaleTimeString());
        chart.data.datasets[0].data.push(graphValues.smoothedLatency);
        chart.data.datasets[1].data.push(graphValues.smoothedBufferSize);
        chart.data.datasets[2].data.push(graphValues.latestFps);
        chart.data.datasets[3].data.push(graphValues.latestBitrate);
        // Push reset event bar (1 = full height bar, null = no bar)
        chart.data.datasets[4].data.push(pendingResetEvent ? 1 : null);
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
    }

    function estimateLatency(latestLatency, latestBuffer) {
        if (!latestLatency || !latestBuffer || isNaN(latestLatency) || isNaN(latestBuffer)) return;

        let now = Date.now();
        // Lower latency if last problem hasn't happened in a while
        if (LAST_LATENCY_PROBLEM && now - LAST_LATENCY_PROBLEM > LATENCY_PROBLEM_COOLDOWN) {
            changeTargetLatency(-0.25)
            LAST_LATENCY_PROBLEM = now;
        }

        if (latestBuffer > latestLatency + UNSTABLE_BUFFER_SEPARATION) {
            // Buffer is larger than latency, slight concern but might be more accurate than latency
            LATENCY_PROBLEM = false;
            // LATENCY_PROBLEM_COUNTER = 0;
            return latestBuffer;
        } else if (latestBuffer < latestLatency - UNSTABLE_BUFFER_SEPARATION && latestLatency < 30) {
            // Buffer is too far below latency, doesn't work above 30 seconds.
            LATENCY_PROBLEM = true;
            LAST_LATENCY_PROBLEM = now;
            recordResetEvent();
            // LATENCY_PROBLEM_COUNTER = 0;
            // return latestBuffer;
            return latestLatency;

        } else if (latestBuffer < MINIMUM_BUFFER) {
            // Buffer too low
            // LATENCY_PROBLEM_COUNTER += 1;

            // Raise the target if the buffer gets too low even if its not buffering yet.
            // if (playbackRate >= 1 && !SEEK_COOLDOWN) {
            //     changeTargetLatency(+0.25)
            // }

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

            // Try NOT returning latestBuffer if it's too low; this changes speed too much. We'll handle it if it actually buffers.
            // return latestBuffer;
            return latestLatency;

        } else {
            LATENCY_PROBLEM = false;
            // LATENCY_PROBLEM_COUNTER = 0;
            return latestLatency;
        }
    }

    function evaluateSpeedAdjustment(latencyEstimate) {
        if (!latencyEstimate || isNaN(latencyEstimate)) return;

        // Determine how far off we are from the target
        let latencyDelta = latencyEstimate - TARGET_LATENCY;
        // Adjust speed if needed
        if (Math.abs(latencyDelta) >= TARGET_LATENCY_TOLERANCE) {
            let newSpeed = ((latencyDelta / SPEED_ADJUSTMENT_FACTOR) + 1).toFixed(2);
            let maxSpeed = pendingResetEvent ? 1 : SPEED_MAX; // Don't accelerate when buffer is draining
            setSpeed(Math.min(Math.max(parseFloat(newSpeed), SPEED_MIN), maxSpeed));
        } else {
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
            // console.log('Found', pathname, 'in LATENCY_SETTINGS:', LATENCY_SETTINGS[pathname]);
        } else {
            TARGET_LATENCY = videoPlayer?.isLiveLowLatency() ? latencyTargetLow : latencyTargetNormal;
        }
        UNSTABLE_BUFFER_SEPARATION = videoPlayer?.isLiveLowLatency() ? unstableBufferSeparationLowLatency : unstableBufferSeparationNormalLatency;
        latencyData.latest = twoDecimalPlaces(videoPlayer?.getLiveLatency());
        bufferData.latest = twoDecimalPlaces(videoPlayer?.getBufferDuration());
        graphValues.latestBitrate = videoPlayer?.getVideoBitRate()/1000;
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
            // console.log('Seeking backwards');
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
