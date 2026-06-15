<script lang="ts">
  import * as THREE from "three";
  import { onMount } from "svelte";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import type { Mesh as ShapeMesh, LineGeometry, Shape } from "$lib/shape";

  interface Props {
    shape: Shape;
    highlightTarget: string;
  }

  let { shape, highlightTarget }: Props = $props();

  let canvas: HTMLCanvasElement;

  function buildMeshGeometry(data: ShapeMesh): THREE.BufferGeometry {
    const positions = new Float32Array(data.faces.length * 9);
    const normals = new Float32Array(data.faces.length * 9);
    const colors = new Float32Array(data.faces.length * 9);
    let i = 0;
    for (const f of data.faces) {
      for (const idx of [f.a, f.b, f.c]) {
        const v = data.vertices[idx];
        positions[i] = v.x;
        positions[i + 1] = v.y;
        positions[i + 2] = v.z;
        normals[i] = f.normal.x;
        normals[i + 1] = f.normal.y;
        normals[i + 2] = f.normal.z;
        colors[i] = f.color.r;
        colors[i + 1] = f.color.g;
        colors[i + 2] = f.color.b;
        i += 3;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }

  function buildLineGeometry(data: LineGeometry): THREE.BufferGeometry {
    const positions = new Float32Array(data.vertices.length * 3);
    data.vertices.forEach((v, k) => {
      positions[k * 3] = v.x;
      positions[k * 3 + 1] = v.y;
      positions[k * 3 + 2] = v.z;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }

  let geometry = buildMeshGeometry(shape.calc3DGeometry());
  let highlightGeometry = buildLineGeometry(shape.calcHighlightGeometry(highlightTarget));

  let mesh: THREE.Mesh;
  let lines: THREE.Line;
  let camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer;

  $effect(() => {
    const next = buildMeshGeometry(shape.calc3DGeometry());
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = next;
    }
    geometry = next;
  });

  $effect(() => {
    const next = buildLineGeometry(shape.calcHighlightGeometry(highlightTarget));
    if (lines) {
      lines.geometry.dispose();
      lines.geometry = next;
    }
    highlightGeometry = next;
  });

  let y = $derived(shape.height / 2);

  function peekDimensions() {
    canvas.width = 0;
    canvas.height = 0;
    canvas.setAttribute("style", "");
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.width / canvas.height;
    camera.updateProjectionMatrix();
  }

  onMount(() => {
    const scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setClearColor(0xffffff, 1);

    const light = new THREE.PointLight(0xffffff, 0.5, 0, 2);
    light.position.set(0, y * 3, 0);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const meshMaterial = new THREE.MeshStandardMaterial({ color: 0xe2725b, vertexColors: true });
    mesh = new THREE.Mesh(geometry, meshMaterial);
    scene.add(mesh);

    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x3333ff });
    lines = new THREE.Line(highlightGeometry, lineMaterial);
    scene.add(lines);

    camera.position.setZ(10);
    camera.position.setY(shape.height * 1.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target = new THREE.Vector3(0, y, 0);

    peekDimensions();

    let frame: number;
    (function loop() {
      frame = requestAnimationFrame(loop);
      controls.target.setY(y);
      controls.update();
      light.position.setY(y * 3);
      renderer.render(scene, camera);
    })();

    return () => cancelAnimationFrame(frame);
  });
</script>

<style>
  article {
    flex: 1 0 0;
    display: flex;
    flex-flow: column;
  }
  h2 {
    flex: 0;
  }
  canvas {
    flex: 1;
  }
</style>

<article>
  <h2>Constructed Shape</h2>
  <canvas width="200" height="200" bind:this={canvas}></canvas>
</article>
