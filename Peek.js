// ==UserScript==
// @name         Peek
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      0.5
// @description  Preview a Twitch channel stream when hovering channel links
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Peek.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/main/Peek.js
// @match        *://*.twitch.tv/*
// @exclude      *://*.twitch.tv/videos/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const VIDEO_WIDTH = 600; // Adjust this single value
    const VIDEO_HEIGHT = Math.round(VIDEO_WIDTH / 1.778); // 16:9 aspect ratio

    const reserved = new Set(["directory","p","settings","downloads","jobs","login","signup","search","videos","subs"]);
    const getChan = (href) => {
        const u = new URL(href, location.origin);
        const seg = u.pathname.split("/").filter(Boolean)[0];
        return (!seg || reserved.has(seg)) ? null : seg.toLowerCase();
    };
    const SHOW_DELAY = 1000;
    let box, timer, currentAnchor, mouseX = 0, mouseY = 0, currentChannel = null, pending = null, mutationFrame = null, mutationRetries = 0;

    const positionBox = () => {
        if (!box) return;
        box.style.left = Math.max(8, mouseX - VIDEO_WIDTH) + "px";
        box.style.top = Math.max(8, mouseY - VIDEO_HEIGHT) + "px";
    };

    document.addEventListener("mousemove", (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        if (box) {
            positionBox();
        }
    });

    const createBox = () => {
        const el = document.createElement("div");
        Object.assign(el.style, {
            position: "fixed",
            zIndex: 999999,
            width: VIDEO_WIDTH + "px",
            height: VIDEO_HEIGHT + "px",
            boxShadow: "0 8px 30px rgba(0,0,0,.35)",
            borderRadius: "10px",
            overflow: "hidden",
            background: "#000"
        });
        document.body.appendChild(el);
        return el;
    };
    const show = (a, chan) => {
        const channelChanged = currentChannel !== chan;
        currentChannel = chan;
        if (!box) {
            box = createBox();
        }
        positionBox();
        if (!channelChanged && box.firstChild) {
            return;
        }
        const parent = encodeURIComponent(location.hostname);
        const src = `https://player.twitch.tv/?channel=${encodeURIComponent(chan)}&parent=${parent}&muted=true&autoplay=true`;
        const ifr = document.createElement("iframe");
        Object.assign(ifr, { src, width: "100%", height: "100%", frameBorder: "0", allow: "autoplay; fullscreen; picture-in-picture" });
        box.replaceChildren(ifr);
    };
    const clearMutationFrame = () => {
        if (mutationFrame !== null) {
            cancelAnimationFrame(mutationFrame);
            mutationFrame = null;
        }
        mutationRetries = 0;
    };
    const hide = () => {
        clearTimeout(timer);
        timer = null;
        pending = null;
        currentChannel = null;
        currentAnchor = null;
        clearMutationFrame();
        if (box) {
            box.replaceChildren();
            box.remove();
            box = null;
        }
    };
    const findHoverTarget = () => {
        const elements = document.elementsFromPoint(mouseX, mouseY);
        for (const el of elements) {
            const anchor = el.closest("a[href]");
            if (!anchor) continue;
            const chan = anchor.dataset.channel || getChan(anchor.href);
            if (!chan) continue;
            return { anchor, chan };
        }
        return null;
    };
    const resolveHoverTarget = (fallback) => {
        if (fallback && document.contains(fallback.anchor)) {
            return fallback;
        }
        const target = findHoverTarget();
        if (!target) return null;
        if (fallback && fallback.chan && target.chan !== fallback.chan) {
            return null;
        }
        return target;
    };
    const scheduleShow = (anchor, chan) => {
        pending = { anchor, chan };
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            if (!pending) return;
            const target = resolveHoverTarget(pending);
            if (!target) {
                pending = null;
                return;
            }
            pending = null;
            currentAnchor = target.anchor;
            show(target.anchor, target.chan);
        }, SHOW_DELAY);
    };
    const delegate = (e) => {
        const a = e.target.closest("a[href]");
        if (!a) return;
        const chan = a.dataset.channel || getChan(a.href);
        if (!chan) return;
        if (e.type === "mouseenter") {
            scheduleShow(a, chan);
        } else if (e.type === "mouseleave") {
            if (currentAnchor === a) {
                hide();
            } else if (pending && pending.anchor === a) {
                pending = null;
                clearTimeout(timer);
                timer = null;
            }
        }
    };
    document.addEventListener("mouseenter", delegate, true);
    document.addEventListener("mouseleave", delegate, true);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) hide();
    });
    window.addEventListener("blur", hide);
    document.addEventListener("pointerdown", hide, true);
    const observer = new MutationObserver(() => {
        if (pending && !document.contains(pending.anchor)) {
            const resolvedPending = resolveHoverTarget(pending);
            if (resolvedPending) {
                pending = resolvedPending;
            } else {
                pending = null;
                clearTimeout(timer);
                timer = null;
            }
        }
        if (currentAnchor && !document.contains(currentAnchor)) {
            clearMutationFrame();
            const fallback = { anchor: currentAnchor, chan: currentChannel };
            const attemptResolve = () => {
                mutationFrame = null;
                if (!currentAnchor || currentAnchor !== fallback.anchor) return;
                if (mutationRetries > 4) {
                    hide();
                    return;
                }
                const resolvedCurrent = resolveHoverTarget(fallback);
                if (resolvedCurrent) {
                    currentAnchor = resolvedCurrent.anchor;
                    show(resolvedCurrent.anchor, resolvedCurrent.chan);
                    mutationRetries = 0;
                } else {
                    mutationRetries += 1;
                    mutationFrame = requestAnimationFrame(attemptResolve);
                }
            };
            mutationFrame = requestAnimationFrame(attemptResolve);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
