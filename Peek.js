// ==UserScript==
// @name         Peek
// @namespace    https://github.com/bubbabdfjhgldkfhg/Twitch-Extension
// @version      0.2
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
    let box, timer, currentAnchor, mouseX = 0, mouseY = 0, currentChannel = null;

    document.addEventListener("mousemove", (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
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
        if (currentChannel === chan && box) return;

        currentChannel = chan;
        if (!box) {
            box = createBox();
        }
        box.style.left = Math.max(8, mouseX - VIDEO_WIDTH) + "px";
        box.style.top = Math.max(8, mouseY - VIDEO_HEIGHT) + "px";
        const parent = encodeURIComponent(location.hostname);
        const src = `https://player.twitch.tv/?channel=${encodeURIComponent(chan)}&parent=${parent}&muted=true&autoplay=true`;
        const ifr = document.createElement("iframe");
        Object.assign(ifr, { src, width: "100%", height: "100%", frameBorder: "0", allow: "autoplay; fullscreen; picture-in-picture" });
        box.replaceChildren(ifr);
    };
    const hide = () => {
        clearTimeout(timer);
        timer = null;
        currentChannel = null;
        currentAnchor = null;
        if (box) {
            box.replaceChildren();
            box.remove();
            box = null;
        }
    };
    const delegate = (e) => {
        const a = e.target.closest("a[href]");
        if (!a) return;
        const chan = a.dataset.channel || getChan(a.href);
        if (!chan) return;
        if (e.type === "mouseenter") {
            currentAnchor = a;
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (currentAnchor === a) {
                    show(a, chan);
                }
            }, SHOW_DELAY);
        } else if (e.type === "mouseleave" && currentAnchor === a) {
            hide();
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
        if (currentAnchor && !document.contains(currentAnchor)) {
            hide();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
