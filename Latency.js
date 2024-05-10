// ==UserScript==
// @name         Latency
// @version      0.2
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

    const range = .14; // Latency jitter to ignore
    const maxDataPoints = 90; // Data history length for the graph
    let latencyTargetLow = 1.25; // Low latency default
    let latencyTargetNormal = 4.25 // Normal latency default
    let targetLatency;

    let desiredPlaybackRate = 1.0;
    let latency;
    let bufferSize;
    let observer;
    let videoPlayer;

    let screenElement = {
        videoContainer: {
            node: null,
            className: 'video-player__overlay'
        },
        currentLatency: {
            node: null,
            className: 'current-latency-text',
            topValue: 'max(0px, calc((100vh - 56.25vw) / 2))',
            opacity: {
                default: '.4',
                current: '.4',
                peak: '1'
            }
        },
        targetLatency: {
            node: null,
            className: 'target-latency-text',
            topValue: 'max(20px, calc((100vh - 56.25vw) / 2) + 18px)',
            opacity: {
                timer: null,
                duration: 1500,
                default: '0',
                current: '0',
                peak: '1'
            }
        },
        graph: {
            node: null,
            className: 'stream-stats-graph',
            opacity: {
                timer: null,
                duration: 4000,
                default: '0',
                current: '0',
                peak: '1'
            }
        }
    }

    let time = new Date().toLocaleTimeString();
    let currentTime = new Date();

    let previousLatencyValues = [];
    let previousBufferValues = [];
    const graphValues = {
        smoothedLatency: null,
        smoothedBufferSize: null,
        latestFps: null,
        latestBitrate: null
    }

    // Create and append the canvas element
    const canvas = document.createElement('canvas');
    canvas.width = '210px';
    canvas.height = '40px';

    // Setup Chart.js
    const ctx = canvas.getContext('2d');
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Latency',
                borderColor: 'orange',
                borderWidth: 2,
                data: [],
                pointRadius: 0,
                yAxisID: 'latency'
            }, {
                label: 'Buffer Size',
                borderColor: 'red',
                borderWidth: 2,
                data: [],
                pointRadius: 0,
                yAxisID: 'latency'
            }, {
                label: 'FPS',
                borderColor: 'yellow',
                borderWidth: 2,
                data: [],
                pointRadius: 0,
                yAxisID: 'frames'
            }, {
                label: 'Bitrate',
                borderColor: 'white',
                borderWidth: 2,
                data: [],
                pointRadius: 0,
                yAxisID: 'bitrate'
            }]
        },
        options: {
            animation: {
                duration: 1000, // Duration for the overall animation
                x: {
                    type: 'number',
                    easing: 'linear',
                    duration: 1000
                },
                y: {
                    duration: 0
                }
            },
            scales: {
                'latency': {
                    beginAtZero: false,
                    min: 0.33, // Twitch seems to consider 0.33 sec buffer as 0
                    display: false,
                },
                'frames': {
                    beginAtZero: true,
                    display: false,
                },
                'bitrate': {
                    type: 'logarithmic',
                    beginAtZero: true,
                    display: false,
                },
                x: {
                    display: false
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });

    function setSpeed(newRate) {
        if (desiredPlaybackRate == newRate) return;
        // console.log('Speed:',newRate);
        desiredPlaybackRate = newRate;
        applyPlaybackRateToAllMedia();
    }

    // Ensures overridePlaybackRate is applied to every media element
    function applyPlaybackRateToAllMedia() {
        const mediaElements = document.querySelectorAll('video, audio');
        mediaElements.forEach(media => {
            if (!media._rateControlApplied) {
                overridePlaybackRate(media);
                media._rateControlApplied = true;
            }
            media.playbackRate = desiredPlaybackRate;
        });
    }

    // Hijacks the native "playbackRate =" function because Twitch will try to abuse it
    function overridePlaybackRate(media) {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate').set;
        Object.defineProperty(media, 'playbackRate', {
            set: function(rate) {
                nativeSetter.call(this, desiredPlaybackRate);
            },
            get: function() {
                return desiredPlaybackRate;
            }
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
                if (targetLatency > 0.75) {
                    changeTargetLatency(-0.25);
                }
                break;
        }
    });

    function changeTargetLatency(delta) {
        // Sketchy way to store latency preferences because they keep getting reset when the video stats randomly flashes the latency to Normal
        if (targetLatency === latencyTargetLow) {
            latencyTargetLow += delta;
            targetLatency = latencyTargetLow;
        } else {
            latencyTargetNormal += delta;
            targetLatency = latencyTargetNormal;
        }
        updateLatencyTextElement('target-latency-text', `${targetLatency.toFixed(2)} sec`);
        temporarilyShowElement(screenElement.targetLatency);
    }

    function temporarilyShowElement(nodeToShow) {
        if (!nodeToShow.node) return;

        nodeToShow.node.style.opacity = nodeToShow.opacity.peak;
        if (nodeToShow.opacity.timer) {
            clearTimeout(nodeToShow.opacity.timer);
        }
        nodeToShow.opacity.timer = setTimeout(function(){
            nodeToShow.node.style.opacity = nodeToShow.opacity.current;
        }, nodeToShow.opacity.duration);
    }

    function attachMouseHoverListeners(newElement) {
        newElement.addEventListener('mouseenter', function() {
            screenElement.currentLatency.opacity.current = screenElement.currentLatency.opacity.peak;
            screenElement.targetLatency.opacity.current = screenElement.currentLatency.opacity.peak;
            screenElement.graph.opacity.current = screenElement.graph.opacity.peak;
            try {
                screenElement.currentLatency.node.style.opacity = screenElement.currentLatency.opacity.peak;
                screenElement.targetLatency.node.style.opacity = screenElement.targetLatency.opacity.peak;
                screenElement.graph.node.style.opacity = screenElement.graph.opacity.peak;
            } catch {
                console.log('Couldnt set opacity');
            }
        });
        newElement.addEventListener('mouseleave', function() {
            screenElement.currentLatency.opacity.current = screenElement.currentLatency.opacity.default;
            screenElement.targetLatency.opacity.current = screenElement.targetLatency.opacity.default;
            screenElement.graph.opacity.current = screenElement.graph.opacity.default;
            try {
                screenElement.currentLatency.node.style.opacity = screenElement.currentLatency.opacity.default;
                screenElement.targetLatency.node.style.opacity = screenElement.targetLatency.opacity.default;
                screenElement.graph.node.style.opacity = screenElement.graph.opacity.default;
            } catch {
                console.log('Couldnt set opacity');
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
             font-size: 1.3rem;
             opacity: ${opacity};`
        ); // padding-top: 0.5rem;
        screenElement.videoContainer.node = document.querySelector(`.${screenElement.videoContainer.className}`);
        screenElement.videoContainer.node.appendChild(newElement);

        attachMouseHoverListeners(newElement);

        return newElement;
    }

    // Function to update an existing latency text element with new inner text
    function updateLatencyTextElement(className, innerText) {
        const latencyElement = document.querySelector(`.${className}`);
        if (latencyElement) {
            latencyElement.innerText = innerText;
        }
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
             width: 210px;
             height: 40px;
             text-align: -webkit-right;`
        );
        videoContainer.appendChild(streamStatsGraph);
        streamStatsGraph.appendChild(canvas);
        // Show stats graph when hovered
        attachMouseHoverListeners(streamStatsGraph);
        // Fill new graph with empty data so it doesnt stretch across the screen
        chart.data.datasets.forEach(dataset => {
            dataset.data = Array(maxDataPoints).fill(null)
        });
        chart.data.labels = Array(maxDataPoints).fill(null);
        // Add node to config
        screenElement.graph.node = streamStatsGraph;
    }

    function updateGraph() {
        if (chart.data.labels.length >= maxDataPoints) {
            chart.data.datasets.forEach(dataset => dataset.data.shift());
            chart.data.labels.shift();
        }

        chart.data.labels.push(time);
        chart.data.datasets[0].data.push(graphValues.smoothedLatency);
        chart.data.datasets[1].data.push(graphValues.smoothedBufferSize);
        chart.data.datasets[2].data.push(graphValues.latestFps);
        chart.data.datasets[3].data.push(graphValues.latestBitrate);
        chart.update();
    }

    function handleLatencyChange() {
        // Ignore 0 and duplicate values
        if (!latency || isNaN(latency) || latency == previousLatencyValues[1]) return;
        // Smooth latency bounce by averaging latest 2 values
        previousLatencyValues.push(latency);
        if (previousLatencyValues.length > 2) previousLatencyValues.shift();
        graphValues.smoothedLatency = (previousLatencyValues[0] + previousLatencyValues[1]) / 2;
    }

    function handleBufferSizeChange() {
        // Ignore 0, impossibly high values, and duplicate values
        // if (!bufferSize || bufferSize > graphValues.smoothedLatency || bufferSize == previousBufferValues[1]) {
        //     return;
        // }
        if (!bufferSize || isNaN(bufferSize) || bufferSize == previousBufferValues[1]) {
            return;
        }
        // Temporary solution to big spikes
        if (bufferSize > 10) {
            // console.log('Ignoring bufferSize:', bufferSize);
            return;
        }
        // Smooth buffer size bounce by averaging latest 2 values
        previousBufferValues.push(bufferSize);
        if (previousBufferValues.length > 2) previousBufferValues.shift();
        graphValues.smoothedBufferSize = (previousBufferValues[0] + previousBufferValues[1]) / 2;
    }

    function evaluateSpeedAdjustment() {
        let [lowerLimit, upperLimit] = [targetLatency - range, targetLatency + range];
        let latencyEstimate = Math.max(graphValues.smoothedLatency, graphValues.smoothedBufferSize);

        if (!latencyEstimate || isNaN(latencyEstimate)) return;

        // Determine how far off we are from the target
        let latencyDelta = 0;
        if (latencyEstimate > upperLimit) {
            latencyDelta = latencyEstimate - upperLimit;
        } else if (latencyEstimate < lowerLimit) {
            latencyDelta = latencyEstimate - lowerLimit;
        }

        // Modify playback rate
        if (latencyDelta) { // Calculates a playback speed from (latencyDelta/7.5) + 1; constrained from 0.75 - 1.5
            setSpeed(Math.min(Math.max(parseFloat(((latencyDelta / 7.5) + 1).toFixed(2)), 0.75), 1.5));
        } else {
            setSpeed(1);
        }
    }

    function handlePageChange() {
        setSpeed(1);
        // previousLatencyValues = [targetLatency];
        // graphValues.smoothedLatency = [];
        // graphValues.smoothedBufferSize = [];
    }

    function setLatencyTextColor(latencyTextElement) {
        if (!latencyTextElement.node || !bufferSize || !latency) {
            // console.log('Missing: latencyTextElement || bufferSize || latency');
            return;
        }

        if (bufferSize > latency) {
            latencyTextElement.node.style.color = 'orange';
            latencyTextElement.node.style.opacity = '1';
        } else if (bufferSize < 0.75) {
            latencyTextElement.node.style.color = 'red';
            latencyTextElement.node.style.opacity = '1';
            temporarilyShowElement(screenElement.graph);
        } else {
            latencyTextElement.node.style.color = 'white';
            // Go to back to whatever opacity it was before
            latencyTextElement.node.style.opacity = latencyTextElement.opacity.current;
        }
    }

    function findReactNode(root, constraint) {
        if (root.stateNode && constraint(root.stateNode)) {
            return root.stateNode;
        }
        let node = root.child;
        while (node) {
            const result = findReactNode(node, constraint);
            if (result) {
                return result;
            }
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
            if (containerName) {
                reactRootNode = rootNode[containerName];
            }
        }
        if (!reactRootNode) {
            console.error('Could not find react root');
        }
        return reactRootNode;
    }

    // Update graph & make sure table is open
    let pollingInterval = setInterval(async function() {
        if (!videoPlayer) {
            videoPlayer = findReactNode(findReactRootNode(), node => node.setPlayerActive && node.props && node.props.mediaPlayerInstance);
            videoPlayer = videoPlayer?.props?.mediaPlayerInstance;
        }
        screenElement.currentLatency.node = createLatencyTextElement(
            screenElement.currentLatency.className,
            screenElement.currentLatency.opacity.default,
            screenElement.currentLatency.topValue);
        screenElement.targetLatency.node = createLatencyTextElement(
            screenElement.targetLatency.className,
            screenElement.targetLatency.opacity.default,
            screenElement.targetLatency.topValue
        );
        updateLatencyTextElement(screenElement.targetLatency.className, `${targetLatency?.toFixed(2)} sec`);

        targetLatency = videoPlayer?.isLiveLowLatency() ? latencyTargetLow : latencyTargetNormal;
        latency = videoPlayer?.getLiveLatency();
        bufferSize = videoPlayer?.getBufferDuration();
        graphValues.latestBitrate = videoPlayer?.getVideoBitRate();
        graphValues.latestFps = videoPlayer?.getVideoFrameRate();

        handleLatencyChange();
        handleBufferSizeChange();

        let textToShow = Math.max(graphValues.smoothedLatency, graphValues.smoothedBufferSize);
        updateLatencyTextElement(screenElement.currentLatency.className, `${textToShow.toFixed(2)} sec`);
        setLatencyTextColor(screenElement.currentLatency);

        evaluateSpeedAdjustment();
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
