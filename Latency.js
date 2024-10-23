// ==UserScript==
// @name         Latency
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      1.9
// @description  Manually set desired latency & graph video stats
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Latency.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Latency.js
// @match        *://*.twitch.tv/*
// @exclude      *://*.twitch.tv/videos/*
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/chart.js
// ==/UserScript==


(function() {
    'use strict';

    let MAX_DATA_POINTS = 90; // Data history length for the graph
    let GRAPH_WIDTH = '210px';
    let GRAPH_HEIGHT = '40px';

    let latencyTargetLow = 1.25; // Low latency default
    let latencyTargetNormal = 4.25; // Normal latency default
    let unstableBufferSeparationLowLatency = 1.5; // Low latency default
    let unstableBufferSeparationNormalLatency = 4; // Normal latency default
    let UNSTABLE_BUFFER_SEPARATION; // Buffer shouldn't be this far below latency
    let TARGET_LATENCY;
    let TARGET_LATENCY_TOLERANCE = 0.125; // Latency jitter to ignore
    let SPEED_ADJUSTMENT_FACTOR = 7.5; // Lower number is more aggresive
    let SPEED_MIN = 0.5;
    let SPEED_MAX = 1.25;

    let newPageStatsCooldownActive = false;
    let newPageStatsCooldownTimer = 2500;

    // let targetBufferSize = 0.8;
    // let bufferRange = 0.125;

    // let bufferHistoryDesiredLength = 120 * 2; // Seconds * 2 because polling happens every 500ms

    // let riskyBufferSize = 0.8;
    // let criticalBufferSize = 0.6;

    let playbackRate = 1.0;
    let videoPlayer;

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

    let latencyData = { latest: null, prev: [] };
    let bufferData = { latest: null, prev: [], history: [] };

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
                { label: 'Latency', borderColor: 'orange', borderWidth: 2, data: [], pointRadius: 0, yAxisID: 'latency' },
                { label: 'Buffer Size', borderColor: 'red', borderWidth: 2, data: [], pointRadius: 0, yAxisID: 'latency' },
                { label: 'FPS', borderColor: 'yellow', borderWidth: 2, data: [], pointRadius: 0, yAxisID: 'frames' },
                { label: 'Bitrate', borderColor: 'white', borderWidth: 2, data: [], pointRadius: 0, yAxisID: 'bitrate' }
            ]
        },
        options: {
            animation: {
                duration: 500,
                x: { type: 'number', easing: 'linear', duration: 500 },
                y: { duration: 0 }
            },
            scales: {
                'latency': { beginAtZero: false, min: 0.33, display: false },
                'frames': { beginAtZero: true, display: false },
                'bitrate': { type: 'logarithmic', beginAtZero: true, display: false },
                x: { display: false }
            },
            plugins: { legend: { display: false } }
        }
    });

    function setSpeed(newRate) {
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
                if (TARGET_LATENCY > 0.75) changeTargetLatency(-0.25);
                break;
        }
    });

    function changeTargetLatency(delta) {
        if (isNaN(delta) || !delta || delta == -Infinity || isNaN(TARGET_LATENCY) || !TARGET_LATENCY) {
            return;
        }
        // Sketchy way to store latency preferences because they keep getting reset when the video stats randomly flashes the latency to Normal
        if (TARGET_LATENCY === latencyTargetLow) {
            latencyTargetLow += delta;
            TARGET_LATENCY = latencyTargetLow;
        } else {
            latencyTargetNormal += delta;
            TARGET_LATENCY = latencyTargetNormal;
        }
        // if (TARGET_LATENCY + delta > 0) TARGET_LATENCY += delta;

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
            `transition: color 0.5s, opacity 0.5s !important;
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
        if (latencyElement) latencyElement.innerText = `${innerText.toFixed(2)} sec`;
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
             right: 65px;
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
        chart.update();
    }

    function isValidDataPoint(statObject) {
        return statObject.latest && !isNaN(statObject.latest) && statObject.latest != statObject.prev[1];
    }

    function handleLatencyChange() {
        if (!isValidDataPoint(latencyData)) return;
        // Smooth latency bounce by averaging latest 2 values
        latencyData.prev.push(latencyData.latest);
        if (latencyData.prev.length > 2) latencyData.prev.shift();
        graphValues.smoothedLatency = (latencyData.prev[0] + latencyData.prev[1]) / 2;
    }

    function handleBufferSizeChange() {
        if (!isValidDataPoint(bufferData)) return;
        // Save the last few minutes of buffer values
        bufferData.history.push(bufferData.latest);
        // if (bufferData.history.length > bufferHistoryDesiredLength) bufferData.history.shift();

        // Temporary solution to big spikes
        if (bufferData.latest < (latencyData.latest + 10)) graphValues.smoothedBufferSize = bufferData.latest;
    }

    function estimateLatency(latestLatency, latestBuffer) {
        if (!latestLatency || !latestBuffer || isNaN(latestLatency) || isNaN(latestBuffer)) return;
        // If buffer is larger than latency OR buffer is 2 seconds below latency, use buffer size for speed adjustment
        if (latestBuffer > latestLatency || latestBuffer < latestLatency - UNSTABLE_BUFFER_SEPARATION) {
            return latestBuffer;
        } else {
            return latestLatency;
        }
    }

    // function calibrateTargetLatency(latencyEstimate) {
    //     // How far we are above the exact target. I don't want to lower from 1.00 if we're seeing red at 1.08
    //     // If we're seeing red at 2.50, I don't want to raise the target from 1.00, I want to raise it from 2.50
    //     let latencyJitter = latencyEstimate - TARGET_LATENCY; // Will be positive if we're above, negative below.
    //     let lowestObservedBuffer = Math.min(...bufferData.history);
    //     // Min 0 because if we're above the risky buffer, there's no reason to go positive.
    //     let riskyBufferSize = targetBufferSize + bufferRange;
    //     let distanceAboveRiskyBuffer = Math.min((riskyBufferSize - lowestObservedBuffer + latencyJitter), 0);
    //     changeTargetLatency(distanceAboveRiskyBuffer);
    //     // Max 0 because if we're below the critical buffer, there's no reason to go negative.
    //     let criticalBufferSize = targetBufferSize - bufferRange;
    //     let distanceBelowCriticalBuffer = Math.max((criticalBufferSize - bufferData.latest + latencyJitter), 0);
    //     changeTargetLatency(distanceBelowCriticalBuffer);
    // }

    function evaluateSpeedAdjustment(latencyEstimate) {
        if (!latencyEstimate || isNaN(latencyEstimate)) return;

        // Determine how far off we are from the target
        let latencyDelta = latencyEstimate - TARGET_LATENCY;
        // Adjust speed if needed
        if (Math.abs(latencyDelta) >= TARGET_LATENCY_TOLERANCE) {
            let newSpeed = ((latencyDelta / SPEED_ADJUSTMENT_FACTOR) + 1).toFixed(2);
            setSpeed(Math.min(Math.max(parseFloat(newSpeed), SPEED_MIN), SPEED_MAX));
        } else {
            setSpeed(1);
        }
    }

    function handlePageChange() {
        newPageStatsCooldownActive = true;
        setTimeout(() => {
            newPageStatsCooldownActive = false;
        }, newPageStatsCooldownTimer);
        // Don't carry over residual speed from last channel
        setSpeed(1);
        // First few latency values on page load can't be trusted
        latencyData.latest = null;
        bufferData.latest = null;
        latencyData.prev = [];
        bufferData.prev = [];
        graphValues.smoothedLatency = null;
        graphValues.smoothedBufferSize = null;
        // Assume a new video player instance was created
        videoPlayer = null;
    }

    function setLatencyTextColor(latencyTextElement) {
        if (!latencyTextElement.node || !bufferData.latest || !latencyData.latest) return;

        if (bufferData.latest > latencyData.latest) {
            latencyTextElement.node.style.color = 'orange';
            latencyTextElement.node.style.opacity = '.8';
        } else if (bufferData.latest < .6 || bufferData.latest < latencyData.latest - UNSTABLE_BUFFER_SEPARATION) {
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
        TARGET_LATENCY = videoPlayer?.isLiveLowLatency() ? latencyTargetLow : latencyTargetNormal;
        UNSTABLE_BUFFER_SEPARATION = videoPlayer?.isLiveLowLatency() ? unstableBufferSeparationLowLatency : unstableBufferSeparationNormalLatency;
        // targetBufferSize = videoPlayer?.isLiveLowLatency() ? 0.75 : 1.25;
        latencyData.latest = videoPlayer?.getLiveLatency();
        bufferData.latest = videoPlayer?.getBufferDuration();
        graphValues.latestBitrate = videoPlayer?.getVideoBitRate()/1000;
        graphValues.latestFps = videoPlayer?.getVideoFrameRate();
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

    // Update graph & make sure table is open
    let pollingInterval = setInterval(async function() {

        if (newPageStatsCooldownActive) {
            return;
        }

        videoPlayer = videoPlayer ?? findReactNode(findReactRootNode(), node => node.setPlayerActive && node.props && node.props.mediaPlayerInstance)?.props.mediaPlayerInstance;
        // console.log('videoPlayer', videoPlayer)

        // let proto = Object.getPrototypeOf(videoPlayer?.getHTMLVideoElement());
        // while (proto) {
        //     console.log(Object.getOwnPropertyNames(proto));
        //     proto = Object.getPrototypeOf(proto);
        // }
        // videoPlayer.getHTMLVideoElement().preservesPitch = false;

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

        // let latencyEstimate = Math.max(graphValues.smoothedLatency, graphValues.smoothedBufferSize);
        updateLatencyTextElement(screenElement.currentLatency.className, latencyEstimate);
        setLatencyTextColor(screenElement.currentLatency);

        // calibrateTargetLatency(latencyEstimate);
        evaluateSpeedAdjustment(latencyEstimate);
        appendGraph();
        updateGraph();

    }, 500);

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
