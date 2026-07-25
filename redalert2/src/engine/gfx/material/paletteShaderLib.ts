import * as THREE from 'three';
export const paletteShaderLib = {
    uniforms: {
        palette: { type: "t", value: null },
        paletteOffsetCount: { value: [0, 1] },
        extraLight: { value: new THREE.Vector3(0, 0, 0) },
    },
    instanceParsVertex: `
#ifdef INSTANCE_TRANSFORM
    attribute float instancePaletteOffset;
    varying float vInstancePaletteOffset;
    attribute vec3 instanceExtraLight;
    varying vec3 vInstanceExtraLight;
#endif
`,
    instanceVertex: `
  #ifdef INSTANCE_TRANSFORM
    vInstancePaletteOffset = instancePaletteOffset;
    vInstanceExtraLight = instanceExtraLight;
  #endif
`,
    paletteColorParsVertex: `
#ifdef VERTEX_PALETTE_OFFSET
    attribute float vertexPaletteOffset;
    varying float vVertexPaletteOffset;
#endif
`,
    paletteColorVertex: `
  #ifdef VERTEX_PALETTE_OFFSET
    vVertexPaletteOffset = vertexPaletteOffset;
  #endif
`,
    paletteColorParsFrag: `
uniform sampler2D palette;
#ifdef VERTEX_PALETTE_OFFSET
    varying float vVertexPaletteOffset;
#endif
uniform vec2 paletteOffsetCount;
uniform vec3 extraLight;

#ifdef INSTANCE_TRANSFORM
varying float vInstancePaletteOffset;
varying vec3 vInstanceExtraLight;
#endif

// Retail lighting multiplies the palette's stored (display-referred) bytes
// directly, so this whole shader works in the palette's own byte domain: the
// palette texture is untagged (TextureUtils.textureFromPalBitmap), every
// lighting multiply below happens on the stored value, and the result is
// written to the drawing buffer as-is with no output encode. Do not
// reintroduce an sRGB decode/encode pair around it — that round trip is the
// identity and costs nine pow() per fragment.
`,
    paletteColorFrag: `
  float paletteColorIndex;

  // Every index texture bound as the diffuse map is single-channel R8, so the
  // palette index always arrives in .r. Deliberately not behind a #define:
  // MergedSpriteMesh and InstancedMesh clone their material, and
  // THREE.Material.copy() does not copy the defines object, so a per-material
  // flag would be dropped on exactly the batched meshes that matter.
  #ifdef USE_MAP
  paletteColorIndex = sampledDiffuseColor.r;
  #endif

  #ifdef USE_COLOR
  paletteColorIndex = vColor.r;
  #endif

  #ifdef INSTANCE_TRANSFORM
  diffuseColor = texture2D(palette, vec2(paletteColorIndex, (vInstancePaletteOffset + 0.5) / paletteOffsetCount.y));
  #elif defined(VERTEX_PALETTE_OFFSET)
  diffuseColor = texture2D(palette, vec2(paletteColorIndex, (vVertexPaletteOffset + 0.5) / paletteOffsetCount.y));
  #else
  diffuseColor = texture2D(palette, vec2(paletteColorIndex, (paletteOffsetCount.x + 0.5) / paletteOffsetCount.y));
  #endif

  #ifdef INSTANCE_OPACITY
  diffuseColor.a *= vInstanceOpacity * opacity;
  #else
  diffuseColor.a *= opacity;
  #endif
  diffuseColor = clamp(diffuseColor, 0.0, 1.0);
`,
    // Replaces three's <colorspace_fragment>, not prepended to it: the value is
    // already in output space. The clamp is load-bearing — <premultiplied_alpha_fragment>
    // runs next and MapShroudLayer draws premultiplied with MultiplyBlending, so a
    // value above 1 would change the blend result.
    paletteOutputFrag: `
  gl_FragColor.rgb = clamp(gl_FragColor.rgb, 0.0, 1.0);
`,
    paletteBasicLightFragment: `
  #ifdef INSTANCE_TRANSFORM
  diffuseColor.rgb += vInstanceExtraLight.rgb * diffuseColor.rgb;
  #else
  diffuseColor.rgb += extraLight.rgb * diffuseColor.rgb;
  #endif

  diffuseColor = clamp(diffuseColor, 0.0, 1.0);
`,
    paletteFullLightFragment: `
  #ifdef INSTANCE_TRANSFORM
  vec3 vxlCellLight = vInstanceExtraLight.rgb;
  #else
  vec3 vxlCellLight = extraLight.rgb;
  #endif

  float vxlDotNL = 0.0;
  #if ( NUM_DIR_LIGHTS > 0 )
  vxlDotNL = saturate( dot( geometryNormal, normalize( directionalLights[ 0 ].direction ) ) );
  #endif

  // Retail voxel shading (CNCMaps VxlRenderer: Ambient 0.8, Diffuse 1.3):
  // palette byte x (0.8 + 1.3*dotNL), then the per-cell map/lamp light
  // (vxlCellLight = Lighting.compute for the occupied tile), all in the
  // palette's stored-byte domain. This REPLACES the stock Phong result:
  // retail voxels are diffuse-only with no specular highlight.
  reflectedLight.directDiffuse = ( 0.8 + 1.3 * vxlDotNL ) * vxlCellLight * material.diffuseColor;
  reflectedLight.indirectDiffuse = vec3( 0.0 );
  reflectedLight.directSpecular = vec3( 0.0 );
  reflectedLight.indirectSpecular = vec3( 0.0 );
`,
    vertexColorMultParsVertex: `
#ifdef USE_VERTEX_COLOR_MULT
attribute vec4 vertexColorMult;
varying vec4 vVertexColorMult;
#endif
`,
    vertexColorMultVertex: `
  #ifdef USE_VERTEX_COLOR_MULT
  vVertexColorMult = vertexColorMult;
  #endif
`,
    vertexColorMultParsFrag: `
#ifdef USE_VERTEX_COLOR_MULT
varying vec4 vVertexColorMult;
#endif
`,
    vertexColorMultFrag: `
  #ifdef USE_VERTEX_COLOR_MULT
  diffuseColor.rgba *= vVertexColorMult.rgba;
  #endif
`,
};
