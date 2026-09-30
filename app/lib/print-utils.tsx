import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import React from 'react';

// Pending timers from a prior in-flight call to printReactComponent. If a second
// print is triggered (e.g. a double-clicked Print button) before the first one's
// print()/removeChild() timers fire, those timers still hold a reference to the
// iframe this call is about to remove. Once removed, that iframe is detached and
// Chrome reports it as a cross-origin frame, so iframe.contentWindow.print() throws
// a SecurityError instead of silently no-oping. Cancelling them here prevents that.
let pendingPrintTimers: ReturnType<typeof setTimeout>[] = [];

export const printReactComponent = (component: React.ReactNode, paperSize: '58mm' | '80mm' = '80mm') => {
    // Clean up any existing print iframes first
    pendingPrintTimers.forEach(clearTimeout);
    pendingPrintTimers = [];

    const existingIframe = document.getElementById('print-iframe');
    if (existingIframe) {
        document.body.removeChild(existingIframe);
    }

    const iframe = document.createElement('iframe');
    iframe.id = 'print-iframe';
    iframe.style.position = 'absolute';
    iframe.style.top = '-10000px';
    iframe.style.left = '-10000px';
    iframe.style.width = paperSize === '80mm' ? '80mm' : '58mm'; 
    iframe.style.height = '100vh'; 
    iframe.style.border = 'none';
    
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) return;

    // Initialize document cleanly
    doc.open();
    doc.write(`
        <!DOCTYPE html>
        <html>
            <head>
                <style>
                    /* Base Reset */
                    body, html { margin: 0; padding: 0; background: white; color: black; }
                    /* Print specific adjustments */
                    @media print {
                        @page { margin: 0; size: ${paperSize} auto; }
                        body { margin: 0; visibility: visible !important; }
                        * { visibility: visible !important; }
                    }
                </style>
            </head>
            <body>
                <div id="print-root"></div>
            </body>
        </html>
    `);
    doc.close();

    // Set base href
    const base = doc.createElement('base');
    base.href = window.location.origin;
    doc.head.appendChild(base);

    // Copy styles from main document manually to ensure they apply
    const styles = document.querySelectorAll('style, link[rel="stylesheet"]');
    styles.forEach(node => {
        const clone = node.cloneNode(true) as HTMLElement;
        if (clone.tagName === 'LINK' && (clone as HTMLLinkElement).href) {
             try {
                (clone as HTMLLinkElement).href = new URL((node as HTMLLinkElement).href, window.location.href).href;
            } catch (e) {
                // ignore invalid urls
            }
        }
        doc.head.appendChild(clone);
    });

    const container = doc.getElementById('print-root');
    if (!container) return;

    const root = createRoot(container);
    
    // Render
    flushSync(() => {
        root.render(component);
    });

    // Wait for content (slightly longer)
    const printTimer = setTimeout(() => {
        try {
            if (iframe.contentWindow) {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            }
        } catch (error) {
            console.error("Print failed:", error);
        } finally {
            // Delay removal
            const removeTimer = setTimeout(() => {
                if (document.body.contains(iframe)) {
                    document.body.removeChild(iframe);
                }
            }, 3000);
            pendingPrintTimers.push(removeTimer);
        }
    }, 1500);
    pendingPrintTimers.push(printTimer);
};
