import * as THREE from "three";

/** Flat-shaded cartoon look: three light steps instead of a smooth gradient. */
function toonGradient(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([120, 195, 255]), 3, 1, THREE.RedFormat);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

export interface SolidOptions {
  /** Size of the dark outline shell; 0 for none. */
  edge?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** An optional texture on the surface. */
  map?: THREE.Texture;
}

/** Shared materials for a scene, and a way to dispose everything created through it in one go. */
export interface Kit {
  gradientMap: THREE.DataTexture;
  /** Registers anything with dispose() to be released with the kit. */
  own<T extends { dispose(): void }>(thing: T): T;
  /** A toon-shaded object with a thin dark outline. */
  solid(geometry: THREE.BufferGeometry, color: number, options?: SolidOptions): THREE.Mesh;
  /** An unlit flat-coloured or textured surface (walls, pictures, glow). */
  flat(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh;
  dispose(): void;
}

export function createKit(): Kit {
  const gradientMap = toonGradient();
  const outline = new THREE.MeshBasicMaterial({ color: 0x1b1b1b, side: THREE.BackSide });
  const owned: { dispose(): void }[] = [gradientMap, outline];
  const own = <T extends { dispose(): void }>(thing: T): T => (owned.push(thing), thing);

  return {
    gradientMap,
    own,
    solid(geometry, color, options = {}) {
      own(geometry);
      const material = own(new THREE.MeshToonMaterial({ color, gradientMap, ...(options.map && { map: options.map }) }));
      const mesh = new THREE.Mesh(geometry, material);
      const edge = options.edge ?? 1.02;
      if (edge) {
        const hull = new THREE.Mesh(geometry, outline);
        hull.scale.setScalar(edge);
        mesh.add(hull);
      }
      mesh.castShadow = options.castShadow ?? true;
      mesh.receiveShadow = options.receiveShadow ?? true;
      return mesh;
    },
    flat(geometry, material) {
      return new THREE.Mesh(own(geometry), own(material));
    },
    dispose() {
      owned.forEach((o) => o.dispose());
    },
  };
}
