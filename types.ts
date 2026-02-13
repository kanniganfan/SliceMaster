export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Frame extends Rect {
  id: string;
  order: number;
  imageData?: string; // Base64 url of the individual frame
}

export interface ImageState {
  url: string;
  width: number;
  height: number;
  file: File;
}

export type ToolMode = 'select' | 'draw' | 'pan';
