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
// directly. The palette texture is sRGB-tagged, so sampling hardware-decodes
// to linear; ra2ToPaletteSpace restores the stored values so every lighting
// multiply below happens in the same domain as the original engine, and
// ra2FromPaletteSpace (see paletteOutputFrag) inverts it again right before
// the renderer's sRGB output encode — the pair cancels exactly.
vec3 ra2ToPaletteSpace( vec3 c ) {
    return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( vec3( 0.0031308 ), c ) );
}
vec3 ra2FromPaletteSpace( vec3 c ) {
    return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( vec3( 0.04045 ), c ) );
}
`,
    paletteColorFrag: `
  float paletteColorIndex;

  #ifdef USE_MAP
  #ifdef USE_RED_INDEX
  paletteColorIndex = sampledDiffuseColor.r;
  #else
  paletteColorIndex = sampledDiffuseColor.a;
  #endif
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
  diffuseColor.rgb = ra2ToPaletteSpace(diffuseColor.rgb);
`,
    paletteOutputFrag: `
  gl_FragColor.rgb = ra2FromPaletteSpace(clamp(gl_FragColor.rgb, 0.0, 1.0));
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
