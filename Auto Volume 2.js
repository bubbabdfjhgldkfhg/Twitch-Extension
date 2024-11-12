// ==UserScript==
// @name         Auto Volume 2
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      0.6
// @description  Analyze audio levels of a Twitch stream using LUFS measurement with visualization
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/refs/heads/main/Auto%20Volume%202.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/refs/heads/main/Auto%20Volume%202.js
// @match        https://www.twitch.tv/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG_MODE = false;
    function debug(...args) {
        if (DEBUG_MODE) {
            const now = new Date();
            const timestamp = now.toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                fractionalSecondDigits: 3
            });
            console.log(`[Auto Volume Debug ${timestamp}]:`, ...args);
        }
    }

    let audioContext;
    let analyser;
    let source;
    let gainNode;
    let rafId;
    let newPageCooldownActive;
    let currentVolume = 1.0;

    const SAMPLE_RATE = 50;
    const BLOCK_SIZE = 4096;
    const LUFS_WINDOW = 800;
    const PLOT_POINTS = 800;

    let lastVolumeAdjustment = 0;
    const VOLUME_CHANGER_MODIFIER = 25; // More sensitive adjustment for headphones
    const VOLUME_DOWN_COOLDOWN = 500; // Faster response for sudden loud sounds
    const VOLUME_UP_COOLDOWN = 5000; // Quicker recovery for quiet sections
    const MAX_DB_THRESHOLD = -25; // Higher threshold for headphone listening
    const MIN_DB_THRESHOLD = -32; // Higher minimum for better audibility
    const MAX_VOLUME = 1;
    const MIN_VOLUME = 0.01;
    const VOLUME_BOOST_THRESHOLD = 1.0;

    const FIXED_TOP = MAX_DB_THRESHOLD + 5;

    // Modified coefficients for headphone frequency response
    const FILTER_COEFFICIENTS = {
        // High shelf filter with reduced high frequency boost
        a: [1.0, -1.69065929318241, 0.73248077421585],
        b: [1.23512485958697, -2.19169618940638, 0.99839281085285]
    };

    // Additional mid-range emphasis filter for headphone clarity
    const HEADPHONE_FILTER = {
        a: [1.0, -1.72076293, 0.74475286],
        b: [1.0, -1.59675561, 0.63675561]
    };

    let blockBuffer = new Float32Array(BLOCK_SIZE);
    let blockBufferIndex = 0;
    let lufsBuffer = Array(LUFS_WINDOW).fill(MAX_DB_THRESHOLD);
    let plotData = Array(PLOT_POINTS).fill((MIN_DB_THRESHOLD + MAX_DB_THRESHOLD)/2);
    let canvas;
    let ctx;

    function initAudio() {
        debug('Initializing audio context');
        const videoElement = document.querySelector('video');
        if (!videoElement) {
            debug('Error: No video element found');
            return;
        }

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = BLOCK_SIZE * 2;

        gainNode = audioContext.createGain();
        gainNode.gain.value = 1.0;

        source = audioContext.createMediaElementSource(videoElement);
        source.connect(gainNode);
        gainNode.connect(analyser);
        analyser.connect(audioContext.destination);

        debug('Audio context initialized', {
            sampleRate: audioContext.sampleRate,
            fftSize: analyser.fftSize
        });

        // Get initial volume and sync gain
        const player = getCurrentPlayer();
        if (player) {
            currentVolume = player.getVolume();
            syncGainWithVolume(currentVolume);
        }

        updateLevel();
    }

    function syncGainWithVolume(volume) {
        if (!gainNode) return;

        if (volume <= VOLUME_BOOST_THRESHOLD) {
            gainNode.gain.value = 1.0;
            return volume;
        } else {
            gainNode.gain.value = volume;
            return 1.0;
        }
    }

    function calculateLUFS(buffer) {
        // Apply headphone-optimized filtering
        const preFilteredBuffer = preFilter(buffer);
        const headphoneFilteredBuffer = headphoneFilter(preFilteredBuffer);
        const kWeightedBuffer = kWeightingFilter(headphoneFilteredBuffer);

        const blocks = [kWeightedBuffer];
        const blockPowers = blocks.map(calculateBlockPower);

        // Modified gating thresholds for headphone listening
        const absoluteThreshold = Math.pow(10, -50/10); // Higher absolute threshold
        const validBlocks = blockPowers.filter(power => power >= absoluteThreshold);

        if (validBlocks.length === 0) {
            return -50; // Higher minimum value for headphones
        }

        const averagePower = validBlocks.reduce((sum, power) => sum + power, 0) / validBlocks.length;
        const relativeThreshold = averagePower * Math.pow(10, -8/10); // Less aggressive gating

        const finalBlocks = validBlocks.filter(power => power >= relativeThreshold);

        if (finalBlocks.length === 0) {
            return -50;
        }

        const finalPower = finalBlocks.reduce((sum, power) => sum + power, 0) / finalBlocks.length;
        const lufs = -0.691 + 10 * Math.log10(finalPower);

        // Clamp to more appropriate range for headphones
        return Math.max(-50, Math.min(-10, lufs));
    }

    function headphoneFilter(buffer) {
        const filtered = new Float32Array(buffer.length);
        const b = HEADPHONE_FILTER.b;
        const a = HEADPHONE_FILTER.a;

        filtered[0] = b[0] * buffer[0];

        for (let i = 1; i < buffer.length; i++) {
            filtered[i] = b[0] * buffer[i];
            if (i - 1 >= 0) filtered[i] += b[1] * buffer[i-1];
            if (i - 2 >= 0) filtered[i] += b[2] * buffer[i-2];
            if (i - 1 >= 0) filtered[i] -= a[1] * filtered[i-1];
            if (i - 2 >= 0) filtered[i] -= a[2] * filtered[i-2];
        }

        return filtered;
    }

    function adjustVolume(volumeDelta) {
        const player = getCurrentPlayer();
        if (player) {
            currentVolume = player.getVolume();
            let newVolume = Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, currentVolume + volumeDelta));
            debug('Adjusting volume', {
                currentVolume: parseFloat(currentVolume.toFixed(2)),
                delta: volumeDelta,
                newVolume: parseFloat(newVolume.toFixed(2))
            });

            currentVolume = newVolume;

            // Sync gain node and get the player volume
            let playerVolume = syncGainWithVolume(currentVolume);
            playerVolume = parseFloat(playerVolume.toFixed(2));

            player.setVolume(playerVolume);
            // Update the twitch volume tracker so the page doesnt get confused
            localStorage.setItem('volume', playerVolume);

            debug('Volume adjustment complete', {
                playerVolume: parseFloat(playerVolume.toFixed(2)),
                gainValue: parseFloat(gainNode.gain.value.toFixed(2))
            });
        } else {
            debug('Warning: Player not found for volume adjustment');
        }
    }

    function preFilter(buffer) {
        // High-shelf filter coefficients (as per ITU-R BS.1770-4)
        const b = FILTER_COEFFICIENTS.b; // Use existing coefficients
        const a = FILTER_COEFFICIENTS.a; // Use existing coefficients

        const filtered = new Float32Array(buffer.length);

        // Initialize first samples
        filtered[0] = b[0] * buffer[0];

        // Process rest of the buffer
        for (let i = 1; i < buffer.length; i++) {
            filtered[i] = b[0] * buffer[i];
            if (i - 1 >= 0) filtered[i] += b[1] * buffer[i-1];
            if (i - 2 >= 0) filtered[i] += b[2] * buffer[i-2];
            if (i - 1 >= 0) filtered[i] -= a[1] * filtered[i-1];
            if (i - 2 >= 0) filtered[i] -= a[2] * filtered[i-2];
        }

        return filtered;
    }

    function kWeightingFilter(buffer) {
        // RLB-weighting filter coefficients
        const b = [1.0, -2.0, 1.0];
        const a = [1.0, -1.99004745483398, 0.99007225036621];

        const filtered = new Float32Array(buffer.length);

        // Initialize first samples
        filtered[0] = b[0] * buffer[0];

        // Process rest of the buffer
        for (let i = 1; i < buffer.length; i++) {
            filtered[i] = b[0] * buffer[i];
            if (i - 1 >= 0) filtered[i] += b[1] * buffer[i-1];
            if (i - 2 >= 0) filtered[i] += b[2] * buffer[i-2];
            if (i - 1 >= 0) filtered[i] -= a[1] * filtered[i-1];
            if (i - 2 >= 0) filtered[i] -= a[2] * filtered[i-2];
        }

        return filtered;
    }

    function calculateBlockPower(block) {
        let sum = 0;
        for (let i = 0; i < block.length; i++) {
            sum += block[i] * block[i];
        }
        const power = sum / block.length;

        // Avoid returning zero or negative power
        return Math.max(1e-12, power);
    }

    function getReactInstance(element) {
        debug('Searching for React instance');
        if (!element) return null;
        for (const key in element) {
            if (key.startsWith('__reactInternalInstance$') || key.startsWith('__reactFiber$')) {
                debug('Found React instance key:', key);
                return element[key];
            }
        }
        debug('No React instance found');
        return null;
    }

    function searchReactParents(node, predicate, maxDepth = 15, depth = 0) {
        try {
            if (predicate(node)) {
                debug('Found matching React parent node at depth:', depth);
                return node;
            }
        } catch (e) {
            debug('Error in predicate:', e);
        }

        if (!node || depth > maxDepth) {
            depth > maxDepth && debug('Max depth reached in React parent search');
            return null;
        }

        const {return: parent} = node;
        if (parent) {
            return searchReactParents(parent, predicate, maxDepth, depth + 1);
        }

        debug('No more parent nodes found');
        return null;
    }

    function getCurrentPlayer() {
        debug('Getting current player');
        const PLAYER_SELECTOR = 'div[data-a-target="player-overlay-click-handler"], .video-player';
        try {
            const node = searchReactParents(
                getReactInstance(document.querySelector(PLAYER_SELECTOR)),
                n => n.memoizedProps?.mediaPlayerInstance?.core != null,
                30
            );
            debug('Player node found:', !!node);
            return node?.memoizedProps.mediaPlayerInstance.core;
        } catch (e) {
            debug('Error getting player:', e);
        }
        return null;
    }

    function updatePlot(shortTermLUFS, averageLUFS) {
        // Update data
        plotData.push(shortTermLUFS);
        plotData.shift();

        // Clear canvas
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Find the lowest LUFS value in the buffer
        const minLUFS = Math.min(...lufsBuffer);

        // Convert LUFS value to Y coordinate using dynamic bottom and fixed top
        const toY = (lufs) => {
            const y = canvas.height - ((lufs - minLUFS) / (FIXED_TOP - minLUFS)) * canvas.height;
            return y;
        };

        // Draw grid lines and labels every 5 dB
        ctx.strokeStyle = '#333333';
        ctx.fillStyle = '#888888';
        ctx.font = '10px monospace';
        let gridStep = 5;
        let startLevel = Math.floor(minLUFS / gridStep) * gridStep;
        let endLevel = Math.ceil(FIXED_TOP / gridStep) * gridStep;

        for (let level = startLevel; level <= endLevel; level += gridStep) {
            let y = toY(level);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
            ctx.fillText(`${level} dB`, 5, y - 2);
        }

        // Draw max threshold line
        ctx.strokeStyle = 'red';
        ctx.beginPath();
        ctx.moveTo(0, toY(MAX_DB_THRESHOLD));
        ctx.lineTo(canvas.width, toY(MAX_DB_THRESHOLD));
        ctx.stroke();

        // Draw min threshold line
        ctx.strokeStyle = 'green';
        ctx.beginPath();
        ctx.moveTo(0, toY(MIN_DB_THRESHOLD));
        ctx.lineTo(canvas.width, toY(MIN_DB_THRESHOLD));
        ctx.stroke();

        // Draw LUFS history
        ctx.strokeStyle = 'cyan';
        ctx.beginPath();
        plotData.forEach((lufs, i) => {
            const x = (i / plotData.length) * canvas.width;
            const y = toY(lufs);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.stroke();

        // Draw legend
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(10, 10, 140, 70);

        ctx.font = '12px monospace';
        ctx.fillStyle = 'white';
        ctx.fillText(`Current: ${shortTermLUFS.toFixed(1)} dB`, 20, 30);
        ctx.fillText(`Average: ${averageLUFS.toFixed(1)} dB`, 20, 50);
        ctx.fillText(`Volume: ${(currentVolume * 100).toFixed(1)}%`, 20, 70);
    }

    function updateLevel() {
        if (!newPageCooldownActive) {
            const array = new Float32Array(analyser.frequencyBinCount);
            analyser.getFloatTimeDomainData(array);

            for (let i = 0; i < array.length; i++) {
                blockBuffer[blockBufferIndex] = array[i];
                blockBufferIndex++;

                if (blockBufferIndex >= BLOCK_SIZE) {
                    const lufs = calculateLUFS(blockBuffer);
                    if (lufs && !isNaN(lufs) && lufs != -Infinity) {
                        lufsBuffer.push(lufs);
                    }
                    if (lufsBuffer.length > LUFS_WINDOW) {
                        lufsBuffer.shift();
                    }
                    const shortTermLUFS = lufsBuffer.slice(-10).reduce((sum, value) => sum + value, 0) / 10;
                    const averageLUFS = lufsBuffer.reduce((sum, value) => sum + value, 0) / lufsBuffer.length;

                    if (DEBUG_MODE) {
                        updatePlot(shortTermLUFS, averageLUFS);
                    }

                    if (Date.now() - lastVolumeAdjustment > VOLUME_DOWN_COOLDOWN) {
                        if (shortTermLUFS > MAX_DB_THRESHOLD) {
                            let adjustment = Math.max(-0.05, (MAX_DB_THRESHOLD-shortTermLUFS)/VOLUME_CHANGER_MODIFIER);
                            adjustment = parseFloat(adjustment.toFixed(2));
                            if (adjustment) {
                                debug('Volume down adjustment', {
                                    adjustment,
                                    reason: 'Above max threshold'
                                });
                                adjustVolume(adjustment);
                                lastVolumeAdjustment = Date.now();
                            }
                        }
                    }
                    if (Date.now() - lastVolumeAdjustment > VOLUME_UP_COOLDOWN) {
                        if (Math.max(...plotData) < MIN_DB_THRESHOLD) {
                            let adjustment = Math.min(0.05, ((MAX_DB_THRESHOLD) - Math.max(...plotData))/VOLUME_CHANGER_MODIFIER);
                            adjustment = parseFloat(adjustment.toFixed(2));
                            if (adjustment) {
                                debug('Volume up adjustment', {
                                    adjustment,
                                    reason: 'Below min threshold'
                                });
                                adjustVolume(adjustment);
                                lastVolumeAdjustment = Date.now();
                            }
                        }
                    }

                    blockBufferIndex = 0;
                }
            }
        }

        rafId = requestAnimationFrame(updateLevel);
    }

    function handlePathChange() {
        debug('Page navigation detected');
        newPageCooldownActive = true;

        // Reset gain node immediately to prevent audio boost bleeding
        if (gainNode) {
            gainNode.gain.value = 1.0;
        }

        setTimeout(() => {
            debug('Navigation cooldown ended');
            const player = getCurrentPlayer();
            if (player) {
                // Get the new page's initial volume
                const newPageVolume = player.getVolume();
                currentVolume = newPageVolume; // Update our volume tracker
                debug('New page volume detected', {
                    newPageVolume: parseFloat(newPageVolume.toFixed(2))
                });

                // Sync gain with the new volume
                syncGainWithVolume(newPageVolume);
            }
            newPageCooldownActive = false;
        }, 2000);

        blockBufferIndex = 0;
        lufsBuffer = Array(LUFS_WINDOW).fill(MAX_DB_THRESHOLD);
        blockBuffer = new Float32Array(BLOCK_SIZE);
    }

    function createVisualization() {
        debug('Creating visualization interface');
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.top = '10px';
        container.style.right = '10px';
        container.style.zIndex = '9999';
        container.style.padding = '10px';
        document.body.appendChild(container);

        canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 200;
        canvas.style.display = 'block';
        container.appendChild(canvas);

        ctx = canvas.getContext('2d');
        debug('Visualization created', {
            canvasWidth: canvas.width,
            canvasHeight: canvas.height
        });
    }

    function init() {
        debug('Initializing script');
        if (DEBUG_MODE) {
            createVisualization();
        }
        const observer = new MutationObserver((mutations) => {
            if (document.querySelector('video')) {
                debug('Video element found, initializing audio');
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
                debug(`History method ${methodName} called`);
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
