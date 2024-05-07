// ==UserScript==
// @name         Latency
// @version      0.1
// @description  Manually set desired latency & graph video stats
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
    let latencyTextElement;
    let targetLatencyElement;
    let streamStatsGraph;
    let latency;
    let bufferSize;
    let observer;
    let videoPlayer;

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
    canvas.height = '35px';

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
                    min: 0.5,
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

        // console.log(`Speed: ${newRate}`);
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
        showTargetLatency();
    }

    function showCurrentLatency() {
        if (isNaN(graphValues.smoothedLatency) || !graphValues.smoothedLatency) return;

        let videoContainer = document.querySelector('.video-player__overlay');
        latencyTextElement = videoContainer.querySelector('.custom-latency-text');
        if (latencyTextElement) {
            latencyTextElement.innerText = `${graphValues.smoothedLatency.toFixed(2)} sec`;
            return;
        }

        latencyTextElement = document.createElement('div');
        latencyTextElement.classList.add('custom-latency-text');
        latencyTextElement.setAttribute(
            'style',
            `transition: color 0.5s, opacity 0.5s !important;
             position: absolute;
             right: 0;
             top: max(0px, calc((100vh - 56.25vw) / 2));
             text-align: right;
             color: white;
             padding-top: 0.5rem;
             padding-right: 0.5rem;
             font-size: 1.3rem;
             opacity: 0.4;`
        );
        videoContainer.appendChild(latencyTextElement);
        // Show stats graph when hovered
        latencyTextElement.addEventListener('mouseenter', function() {
            streamStatsGraph.style.opacity = '.7';
        });
        latencyTextElement.addEventListener('mouseleave', function() {
            streamStatsGraph.style.opacity = '0';
        });
    }

    function showTargetLatency() {
        // Remove the existing target latency element if it exists
        document.getElementById('buffer-values-row')?.remove();

        if (!latencyTextElement) {
            console.error('Custom latency text element not found');
            return;
        }
        let targetLatencyElement = document.createElement('div');
        targetLatencyElement.id = 'buffer-values-row';
        targetLatencyElement.innerText = `${targetLatency.toFixed(2)} sec`;
        latencyTextElement.appendChild(targetLatencyElement);
    }

    // Plot the video stats values
    function appendGraph() {
        let videoContainer = document.querySelector('.video-player__overlay');
        streamStatsGraph = videoContainer.querySelector('.stream-stats-graph');
        if (streamStatsGraph) return;

        streamStatsGraph = document.createElement('div');
        streamStatsGraph.classList.add('stream-stats-graph');
        streamStatsGraph.setAttribute(
            'style',
            `transition: opacity 0.5s !important;
             position: absolute;
             right: 65px;
             top: max(0px, calc((100vh - 56.25vw) / 2));
             opacity: 0;
             width: 210px;
             height: 35px;
             text-align: -webkit-right;`
        );
        videoContainer.appendChild(streamStatsGraph);
        streamStatsGraph.appendChild(canvas);
        // Show stats graph when hovered
        streamStatsGraph.addEventListener('mouseenter', function() {
            streamStatsGraph.style.opacity = '.7';
        });
        streamStatsGraph.addEventListener('mouseleave', function() {
            streamStatsGraph.style.opacity = '0';
        });

        // Fill new graph with empty data so it doesnt stretch across the screen
        chart.data.datasets.forEach(dataset => {
            dataset.data = Array(maxDataPoints).fill(null)
        });
        chart.data.labels = Array(maxDataPoints).fill(null);
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
        if (!latency || latency == previousLatencyValues[1]) return;
        // Smooth latency bounce by averaging latest 2 values
        previousLatencyValues.push(latency);
        if (previousLatencyValues.length > 2) previousLatencyValues.shift();
        graphValues.smoothedLatency = (previousLatencyValues[0] + previousLatencyValues[1]) / 2;
        // Update the onscreen latency value
        showCurrentLatency();
        // Set boundaries for acceptable jitter
        let [lowerLimit, upperLimit] = [targetLatency - range, targetLatency + range];
        // Determine how far off we are from the target
        let latencyDelta = 0;
        if (graphValues.smoothedLatency > upperLimit) {
            latencyDelta = graphValues.smoothedLatency - upperLimit;
        } else if (graphValues.smoothedLatency < lowerLimit) {
            latencyDelta = graphValues.smoothedLatency - lowerLimit;
        }
        // Modify playback rate
        if (latencyDelta) { // Calculates a playback speed from (latencyDelta/7.5) + 1; constrained from 0.75 - 1.5
            setSpeed(Math.min(Math.max(parseFloat(((latencyDelta / 7.5) + 1).toFixed(2)), 0.75), 1.5));
        } else {
            setSpeed(1);
        }
    }

    function handleBufferSizeChange() {
        // Ignore 0, impossibly high values, and duplicate values
        if (!bufferSize || bufferSize > graphValues.smoothedLatency || bufferSize == previousBufferValues[1]) {
            return;
        }
        // Smooth buffer size bounce by averaging latest 2 values
        previousBufferValues.push(bufferSize);
        if (previousBufferValues.length > 2) previousBufferValues.shift();
        graphValues.smoothedBufferSize = (previousBufferValues[0] + previousBufferValues[1]) / 2;
    }

    function handlePageChange() {
        setSpeed(1);
        previousLatencyValues = [targetLatency];
    }

    function setLatencyTextColor() {
        if (!latencyTextElement || !bufferSize || !latency) return;

        if (bufferSize > latency) {
            latencyTextElement.style.color = 'orange';
            latencyTextElement.style.opacity = .8;
        } else if (bufferSize < 0.75) {
            latencyTextElement.style.color = 'red';
            latencyTextElement.style.opacity = .8;
        } else {
            latencyTextElement.style.color = 'white';
            latencyTextElement.style.opacity = .4;
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

        targetLatency = videoPlayer?.isLiveLowLatency() ? latencyTargetLow : latencyTargetNormal;
        latency = videoPlayer?.getLiveLatency();
        bufferSize = videoPlayer?.getBufferDuration();
        graphValues.latestBitrate = videoPlayer?.getVideoBitRate();
        graphValues.latestFps = videoPlayer?.getVideoFrameRate();

        setLatencyTextColor();
        handleLatencyChange();
        handleBufferSizeChange();
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
