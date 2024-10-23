// ==UserScript==
// @name         Auto Volume with LUFS Visualization
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      1.1
// @description  Analyze audio levels of a Twitch stream using LUFS measurement with visualization
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/refs/heads/main/Auto%20Volume%20(LUFS).js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/refs/heads/main/Auto%20Volume%20(LUFS).js
// @match        https://www.twitch.tv/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let SHOW_GRAPH = false;

    let audioContext;
    let analyser;
    let source;
    let rafId;
    let newPageCooldownActive;

    const SAMPLE_RATE = 50; // How many times per second to sample
    const BLOCK_SIZE = 4096; // ~85ms at 48kHz
    const LUFS_WINDOW = 1800; // 10 seconds at 50 samples per second
    const PLOT_POINTS = 1800; // Number of points to show in the plot

    let lastVolumeAdjustment = 0;
    const VOLUME_CHANGER_MODIFIER = 50; // Lower is more aggresive
    const VOLUME_DOWN_COOLDOWN = 500;
    const VOLUME_UP_COOLDOWN = 5000; // 5 second cooldown
    const MAX_DB_THRESHOLD = -30; // LUFS
    const MIN_DB_THRESHOLD = -50; // LUFS
    const VOLUME_ADJUSTMENT = 0.005; // .1%
    const MAX_VOLUME = 1.0;
    const MIN_VOLUME = 0.05;

    // Graph settings
    const GRAPH_PADDING = 15; // LUFS
    const GRAPH_MIN = Math.floor((MIN_DB_THRESHOLD - GRAPH_PADDING) / 5) * 5; // Round down to nearest 5
    const GRAPH_MAX = Math.ceil((MAX_DB_THRESHOLD + GRAPH_PADDING) / 5) * 5; // Round up to nearest 5
    const GRAPH_RANGE = GRAPH_MAX - GRAPH_MIN;

    const FILTER_COEFFICIENTS = {
        a: [1.0, -1.69065929318241, 0.73248077421585],
        b: [1.53512485958697, -2.69169618940638, 1.19839281085285]
    };

    let blockBuffer = new Float32Array(BLOCK_SIZE);
    let blockBufferIndex = 0;
    let lufsBuffer = Array(LUFS_WINDOW).fill((MIN_DB_THRESHOLD + MAX_DB_THRESHOLD)/2);
    let plotData = Array(PLOT_POINTS).fill((MIN_DB_THRESHOLD + MAX_DB_THRESHOLD)/2);
    let debugElement;
    let canvas;
    let ctx;

    function initAudio() {
        const videoElement = document.querySelector('video');
        if (!videoElement) {
            console.error('No video element found');
            return;
        }

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = BLOCK_SIZE * 2;

        source = audioContext.createMediaElementSource(videoElement);
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        updateLevel();
    }

    function calculateLUFS(buffer) {
        let filtered = new Float32Array(buffer.length);
        for (let i = 2; i < buffer.length; i++) {
            filtered[i] = FILTER_COEFFICIENTS.b[0] * buffer[i] +
                FILTER_COEFFICIENTS.b[1] * buffer[i-1] +
                FILTER_COEFFICIENTS.b[2] * buffer[i-2] -
                FILTER_COEFFICIENTS.a[1] * filtered[i-1] -
                FILTER_COEFFICIENTS.a[2] * filtered[i-2];
        }

        const meanSquare = filtered.reduce((sum, sample) => sum + sample * sample, 0) / buffer.length;
        return -0.691 + 10 * Math.log10(meanSquare);
    }

    function getReactInstance(element) {
        if (!element) return null;
        for (const key in element) {
            if (key.startsWith('__reactInternalInstance$') || key.startsWith('__reactFiber$')) {
                return element[key];
            }
        }
        return null;
    }

    function searchReactParents(node, predicate, maxDepth = 15, depth = 0) {
        try {
            if (predicate(node)) {
                return node;
            }
        } catch (_) {}

        if (!node || depth > maxDepth) {
            return null;
        }

        const {return: parent} = node;
        if (parent) {
            return searchReactParents(parent, predicate, maxDepth, depth + 1);
        }

        return null;
    }

    function getCurrentPlayer() {
        const PLAYER_SELECTOR = 'div[data-a-target="player-overlay-click-handler"], .video-player';
        try {
            const node = searchReactParents(
                getReactInstance(document.querySelector(PLAYER_SELECTOR)),
                n => n.memoizedProps?.mediaPlayerInstance?.core != null,
                30
            );
            return node?.memoizedProps.mediaPlayerInstance.core;
        } catch (e) {
            console.error("Failed to retrieve the player:", e);
        }
        return null;
    }

    function adjustVolume(volumeDelta) {
        const player = getCurrentPlayer();
        if (player) {
            const currentVolume = player.getVolume();
            const newVolume = Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, currentVolume + volumeDelta));
            player.setVolume(newVolume);
            console.log(`Volume changed to ${newVolume.toFixed(2)}`);
            if (SHOW_GRAPH) {
                updateDebugInfo(`Volume: ${newVolume.toFixed(2)}`);
            }
        } else {
            console.warn("Player not found.");
        }
    }

    function updatePlot(shortTermLUFS, averageLUFS) {
        plotData.push(shortTermLUFS);
        plotData.shift();

        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);

        // Draw background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, width, height);

        // Draw grid
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        for (let i = GRAPH_MIN; i <= GRAPH_MAX; i += 5) {
            const y = height - ((i - GRAPH_MIN) / GRAPH_RANGE) * height;
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            // Add LUFS labels
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.fillText(i.toString(), 5, y - 2);
        }
        ctx.stroke();

        // Draw thresholds
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
        ctx.beginPath();
        const maxY = height - ((MAX_DB_THRESHOLD - GRAPH_MIN) / GRAPH_RANGE) * height;
        ctx.moveTo(0, maxY);
        ctx.lineTo(width, maxY);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
        ctx.beginPath();
        const minY = height - ((MIN_DB_THRESHOLD - GRAPH_MIN) / GRAPH_RANGE) * height;
        ctx.moveTo(0, minY);
        ctx.lineTo(width, minY);
        ctx.stroke();

        // Draw LUFS line
        ctx.strokeStyle = 'cyan';
        ctx.beginPath();
        ctx.moveTo(0, height - ((plotData[0] - GRAPH_MIN) / GRAPH_RANGE) * height);
        for (let i = 1; i < plotData.length; i++) {
            const x = (i / plotData.length) * width;
            const y = height - ((plotData[i] - GRAPH_MIN) / GRAPH_RANGE) * height;
            ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Draw average LUFS
        ctx.strokeStyle = 'yellow';
        const avgY = height - ((averageLUFS - GRAPH_MIN) / GRAPH_RANGE) * height;
        ctx.beginPath();
        ctx.moveTo(0, avgY);
        ctx.lineTo(width, avgY);
        ctx.stroke();

        // Add legend
        const legendY = 15;
        const legendSpacing = 80;
        ctx.font = '10px monospace';

        ctx.strokeStyle = 'red';
        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.moveTo(10, legendY);
        ctx.lineTo(30, legendY);
        ctx.stroke();
        ctx.fillText(`Max: ${MAX_DB_THRESHOLD}`, 35, legendY + 4);

        ctx.strokeStyle = 'green';
        ctx.fillStyle = 'green';
        ctx.beginPath();
        ctx.moveTo(10 + legendSpacing, legendY);
        ctx.lineTo(30 + legendSpacing, legendY);
        ctx.stroke();
        ctx.fillText(`Min: ${MIN_DB_THRESHOLD}`, 35 + legendSpacing, legendY + 4);

        ctx.strokeStyle = 'yellow';
        ctx.fillStyle = 'yellow';
        ctx.beginPath();
        ctx.moveTo(10 + legendSpacing * 2, legendY);
        ctx.lineTo(30 + legendSpacing * 2, legendY);
        ctx.stroke();
        ctx.fillText(`Avg: ${averageLUFS.toFixed(1)}`, 35 + legendSpacing * 2, legendY + 4);

        ctx.strokeStyle = 'cyan';
        ctx.fillStyle = 'cyan';
        ctx.beginPath();
        ctx.moveTo(10 + legendSpacing * 3, legendY);
        ctx.lineTo(30 + legendSpacing * 3, legendY);
        ctx.stroke();
        ctx.fillText(`Now: ${shortTermLUFS.toFixed(1)}`, 35 + legendSpacing * 3, legendY + 4);
    }

    function updateLevel() {
        const array = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatTimeDomainData(array);

        for (let i = 0; i < array.length; i++) {
            blockBuffer[blockBufferIndex] = array[i];
            blockBufferIndex++;

            if (blockBufferIndex >= BLOCK_SIZE && !newPageCooldownActive) {

                const lufs = calculateLUFS(blockBuffer);
                if (lufs && !isNaN(lufs) && lufs != -Infinity) {
                    lufsBuffer.push(lufs);
                }
                if (lufsBuffer.length > LUFS_WINDOW) {
                    lufsBuffer.shift();
                }
                const shortTermLUFS = lufsBuffer.slice(-10).reduce((sum, value) => sum + value, 0) / 10;
                const averageLUFS = lufsBuffer.reduce((sum, value) => sum + value, 0) / lufsBuffer.length;

                if (SHOW_GRAPH) {
                    updatePlot(shortTermLUFS, averageLUFS);
                }

                if (Date.now() - lastVolumeAdjustment > VOLUME_DOWN_COOLDOWN) {
                    if (shortTermLUFS > MAX_DB_THRESHOLD) {
                        adjustVolume(Math.max(-0.1, (MAX_DB_THRESHOLD-shortTermLUFS)/VOLUME_CHANGER_MODIFIER));
                        lastVolumeAdjustment = Date.now();
                    }
                }
                if (Date.now() - lastVolumeAdjustment > VOLUME_UP_COOLDOWN) {
                    if (Math.max(...lufsBuffer) < MAX_DB_THRESHOLD - 2) {
                        adjustVolume(Math.min(0.05, ((MAX_DB_THRESHOLD) - Math.max(...lufsBuffer))/VOLUME_CHANGER_MODIFIER));
                        lastVolumeAdjustment = Date.now()
                    }
                }

                blockBufferIndex = 0;
            }
        }

        rafId = requestAnimationFrame(updateLevel);
    }

    function handlePathChange() {
        newPageCooldownActive = true;
        setTimeout(() => {
            newPageCooldownActive = false;
        }, 3000);

        blockBufferIndex = 0;
        lufsBuffer = Array(LUFS_WINDOW).fill(MAX_DB_THRESHOLD);
        adjustVolume(0);
    }

    function createDebugElement() {
        debugElement = document.createElement('div');
        debugElement.style.position = 'fixed';
        debugElement.style.top = '10px';
        debugElement.style.right = '10px';
        debugElement.style.zIndex = '9999';
        debugElement.style.padding = '10px';
        document.body.appendChild(debugElement);

        canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 200;
        canvas.style.display = 'block';
        canvas.style.marginBottom = '5px';
        debugElement.appendChild(canvas);

        ctx = canvas.getContext('2d');
        ctx.font = '10px monospace';
    }

    function updateDebugInfo(info) {
        if (debugElement) {
            const textDiv = debugElement.querySelector('div') || document.createElement('div');
            textDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            textDiv.style.color = 'white';
            textDiv.style.padding = '5px';
            textDiv.textContent = info;
            if (!textDiv.parentElement) {
                debugElement.appendChild(textDiv);
            }
        }
    }

    function init() {
        createDebugElement();
        const observer = new MutationObserver((mutations) => {
            if (document.querySelector('video')) {
                observer.disconnect();
                initAudio();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

    (function(history){
        const overrideHistoryMethod = (methodName) => {
            const original = history[methodName];
            history[methodName] = function(state) {
                const result = original.apply(this, arguments);
                setTimeout(handlePathChange, 0);
                return result;
            };
        };
        overrideHistoryMethod('pushState');
        overrideHistoryMethod('replaceState');
    })(window.history);
    window.addEventListener('popstate', handlePathChange);

})();
