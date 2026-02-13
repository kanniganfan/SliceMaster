import { Rect } from '../types';

/**
 * Detects non-transparent islands in an image.
 * Supports both Alpha transparency and Solid Color backgrounds (auto-detected).
 * 
 * @param imageSrc Source image URL
 * @param threshold Color distance threshold
 * @param ignoreNested If true, ignores/merges rects that are fully contained within larger rects
 * @param minArea Minimum area (width * height) to be considered a sprite
 */
export const detectSprites = (
  imageSrc: string,
  threshold: number = 10,
  ignoreNested: boolean = false,
  minArea: number = 64
): Promise<Rect[]> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageSrc;
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      // 'willReadFrequently' optimizes for heavy readback operations
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      if (!ctx) {
        reject('Canvas context not available');
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data, width, height } = imageData;
      
      const visited = new Uint8Array(width * height);
      let rects: Rect[] = [];

      // ---------------------------------------------------------
      // ROBUST BACKGROUND DETECTION
      // ---------------------------------------------------------
      let transparentCount = 0;
      const colorCounts: Record<string, number> = {};
      let maxColorCount = 0;
      let dominantColor = { r: 0, g: 0, b: 0 };

      const checkPixelForBg = (index: number) => {
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const a = data[index + 3];
        
        if (a < 50) {
          transparentCount++;
        } else {
          const key = `${r},${g},${b}`;
          colorCounts[key] = (colorCounts[key] || 0) + 1;
          if (colorCounts[key] > maxColorCount) {
            maxColorCount = colorCounts[key];
            dominantColor = { r, g, b };
          }
        }
      };

      // Sample Borders
      for (let x = 0; x < width; x++) {
        checkPixelForBg(x * 4); // Top row
        checkPixelForBg((x + (height - 1) * width) * 4); // Bottom row
      }
      for (let y = 1; y < height - 1; y++) {
        checkPixelForBg((y * width) * 4); // Left col
        checkPixelForBg((width - 1 + y * width) * 4); // Right col
      }

      const totalBorderPixels = (width * 2) + (height * 2) - 4;
      const isTransparentBg = transparentCount > (totalBorderPixels * 0.5);
      
      const bgR = dominantColor.r;
      const bgG = dominantColor.g;
      const bgB = dominantColor.b;
      
      const isSpritePixel = (index: number) => {
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const a = data[index + 3];

        if (a < 50) return false;

        if (isTransparentBg) {
          return true;
        } else {
          const dist = Math.sqrt(
            Math.pow(r - bgR, 2) +
            Math.pow(g - bgG, 2) +
            Math.pow(b - bgB, 2)
          );
          return dist > threshold * 2.5; 
        }
      };

      // BFS to find connected component
      const findComponent = (startX: number, startY: number): Rect | null => {
        let minX = startX, maxX = startX, minY = startY, maxY = startY;
        const queue = [startX + startY * width];
        visited[startX + startY * width] = 1;
        
        let pixelCount = 0;

        while (queue.length > 0) {
          const currIndex = queue.shift()!;
          const currX = currIndex % width;
          const currY = Math.floor(currIndex / width);

          pixelCount++;

          if (currX < minX) minX = currX;
          if (currX > maxX) maxX = currX;
          if (currY < minY) minY = currY;
          if (currY > maxY) maxY = currY;

          const neighbors = [
            { x: currX + 1, y: currY },
            { x: currX - 1, y: currY },
            { x: currX, y: currY + 1 },
            { x: currX, y: currY - 1 },
            { x: currX + 1, y: currY + 1 },
            { x: currX - 1, y: currY - 1 },
            { x: currX + 1, y: currY - 1 },
            { x: currX - 1, y: currY + 1 },
          ];

          for (const n of neighbors) {
            if (n.x >= 0 && n.x < width && n.y >= 0 && n.y < height) {
              const nIndex = n.x + n.y * width;
              if (!visited[nIndex]) {
                 if (isSpritePixel(nIndex * 4)) {
                    visited[nIndex] = 1;
                    queue.push(nIndex);
                 } else {
                    visited[nIndex] = 1; 
                 }
              }
            }
          }
        }

        const w = maxX - minX + 1;
        const h = maxY - minY + 1;
        
        // Filter by Area
        if (pixelCount < minArea || (w * h) < minArea) return null;
        // Basic dimension check
        if (w < 4 || h < 4) return null;

        return {
          x: minX,
          y: minY,
          width: w,
          height: h,
        };
      };

      // Scan the image
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const index = x + y * width;
          if (!visited[index]) {
             if (isSpritePixel(index * 4)) {
                const rect = findComponent(x, y);
                if (rect) {
                  rects.push(rect);
                }
             } else {
                visited[index] = 1;
             }
          }
        }
      }

      // ---------------------------------------------------------
      // POST-PROCESSING: Ignore Nested
      // ---------------------------------------------------------
      if (ignoreNested && rects.length > 1) {
          // Sort by area descending so we process larger rects first
          rects.sort((a, b) => (b.width * b.height) - (a.width * a.height));
          
          const filteredRects: Rect[] = [];
          
          for (let i = 0; i < rects.length; i++) {
              const inner = rects[i];
              let isContained = false;

              for (let j = 0; j < filteredRects.length; j++) {
                  const outer = filteredRects[j];
                  // Check if inner is fully inside outer (or very close to it)
                  // Using a loose containment (allowing 1px margin of error)
                  if (
                      inner.x >= outer.x && 
                      inner.y >= outer.y && 
                      (inner.x + inner.width) <= (outer.x + outer.width) && 
                      (inner.y + inner.height) <= (outer.y + outer.height)
                  ) {
                      isContained = true;
                      break;
                  }
              }

              if (!isContained) {
                  filteredRects.push(inner);
              }
          }
          rects = filteredRects;
      }

      // Sort by Y then X (reading order) for final output
      rects.sort((a, b) => {
        const rowDiff = a.y - b.y;
        if (Math.abs(rowDiff) > 15) {
            return rowDiff;
        }
        return a.x - b.x;
      });
      
      resolve(rects);
    };

    img.onerror = (err) => reject(err);
  });
};

/**
 * Crop a specific rect from an image and return base64
 */
export const cropFrame = (sourceImage: string, rect: Rect): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = sourceImage;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = rect.width;
      canvas.height = rect.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(
          img,
          rect.x, rect.y, rect.width, rect.height,
          0, 0, rect.width, rect.height
        );
        resolve(canvas.toDataURL());
      }
    };
  });
};