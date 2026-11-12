import { CanvasSource, Texture } from "pixi.js";

/** Wraps a canvas in a nearest-neighbour Pixi texture. */
export function canvasTexture(canvas: HTMLCanvasElement): Texture {
  return new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }) });
}
