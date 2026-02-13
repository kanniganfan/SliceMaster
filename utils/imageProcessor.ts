/**
 * Image Processing Utilities
 * Operating directly on ImageData for performance
 */

/**
 * Performs a Flood Fill (Magic Wand) operation on ImageData
 */
export const floodFill = (
    imageData: ImageData,
    startX: number,
    startY: number,
    targetColor: { r: number, g: number, b: number, a: number },
    tolerance: number, // 0-100
    contiguous: boolean
): void => {
    const { data, width, height } = imageData;
    const maxDist = 442; // Sqrt(255^2 * 3)
    const distThreshold = (tolerance / 100) * maxDist;
    
    // Helper: Check if pixel matches target within tolerance
    const matchColor = (idx: number) => {
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];

        if (targetColor.a === 0) {
            // If targeting transparent, we match low alpha
            return a < (tolerance / 100) * 255;
        }

        // Avoid modifying already transparent pixels if we are not targeting transparency
        if (a === 0 && targetColor.a !== 0) return false;

        const dist = Math.sqrt(
            Math.pow(r - targetColor.r, 2) + 
            Math.pow(g - targetColor.g, 2) + 
            Math.pow(b - targetColor.b, 2)
        );
        return dist <= distThreshold;
    };

    if (contiguous) {
        // Stack-based flood fill
        const stack = [[startX, startY]];
        const visited = new Uint8Array(width * height);
        const startIdx = (startY * width + startX);
        
        // If start pixel doesn't match criteria (unlikely since we clicked it, but good safety), abort
        if (!matchColor(startIdx * 4)) return;

        visited[startIdx] = 1;

        while (stack.length > 0) {
            const [cx, cy] = stack.pop()!;
            const currIdx = (cy * width + cx) * 4;

            data[currIdx + 3] = 0; // Set Alpha to 0

            const neighbors = [
                [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]
            ];

            for (const [nx, ny] of neighbors) {
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nOffset = ny * width + nx;
                    if (!visited[nOffset]) {
                        if (matchColor(nOffset * 4)) {
                            visited[nOffset] = 1;
                            stack.push([nx, ny]);
                        }
                    }
                }
            }
        }
    } else {
        // Global Color Replace
        for (let i = 0; i < data.length; i += 4) {
            if (data[i+3] !== 0) {
                if (matchColor(i)) {
                    data[i + 3] = 0;
                }
            }
        }
    }
};

/**
 * Applies a blur to the Alpha channel only to soften edges (Feathering)
 * Uses a simple box blur or gaussian approximation
 */
export const featherEdges = (imageData: ImageData, amount: number): ImageData => {
    if (amount <= 0) return imageData;

    const { data, width, height } = imageData;
    // We need a copy to read from while writing to 'data'
    const input = new Uint8ClampedArray(data); 
    
    // Amount is radius. 
    // Simple 1-pass horizontal + vertical box blur on Alpha channel
    const radius = Math.floor(amount);

    // Helper to get alpha from input
    const getAlpha = (x: number, y: number) => {
        const idx = (y * width + x) * 4 + 3;
        return input[idx];
    };

    // Horizontal pass
    const tempAlpha = new Float32Array(width * height);
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0;
            let count = 0;
            for (let k = -radius; k <= radius; k++) {
                const px = Math.min(width - 1, Math.max(0, x + k));
                sum += getAlpha(px, y);
                count++;
            }
            tempAlpha[y * width + x] = sum / count;
        }
    }

    // Vertical pass & Write back
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            let sum = 0;
            let count = 0;
            for (let k = -radius; k <= radius; k++) {
                const py = Math.min(height - 1, Math.max(0, y + k));
                sum += tempAlpha[py * width + x];
                count++;
            }
            const avg = sum / count;
            
            // Apply only if the pixel was originally visible or close to visible
            // We only want to blur existing edges, not make the whole empty space gray
            // But for simple feathering, modifying alpha is enough.
            // However, we must ensure RGB values exist if alpha goes from 0 -> >0
            // Since we don't know the RGB of transparent pixels, this simplistic feather 
            // works best for shrinking opaque areas (making edges transparent) rather than growing them.
            
            const idx = (y * width + x) * 4;
            // Strategy: Only soften edges. If original alpha was 0, keep it 0 (Inner Feather)
            // Or allow growing? Growing requires color bleeding.
            // Let's stick to Inner Feathering (eroding edges) for safety.
            
            const originalAlpha = input[idx + 3];
            if (originalAlpha > 0) {
                 data[idx + 3] = Math.min(originalAlpha, avg); 
            }
        }
    }

    return imageData;
};
