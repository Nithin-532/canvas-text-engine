#version 300 es

// Per-vertex data (a simple quad forming the glyph boundary)
layout(location = 0) in vec2 a_quadVertex; // [0,0] to [1,1]

// Per-instance data (the glyph layout parameters)
// Includes the top-left X/Y position of the glyph quad
layout(location = 1) in vec2 a_instancePos;
// The width and height of the glyph quad
layout(location = 2) in vec2 a_instanceSize;
// The UV coordinates in the MSDF atlas
layout(location = 3) in vec2 a_uvTopLeft;
layout(location = 4) in vec2 a_uvBottomRight;
// Per-instance color (RGB 0-1)
layout(location = 5) in vec3 a_instanceColor;

// Uniforms
uniform vec2 u_resolution; // Canvas size in logical pixels
uniform mat3 u_transform;  // Camera transform (pan/zoom)

// Output to fragment shader
out vec2 v_uv;
out vec3 v_color;

void main() {
    // 1. Calculate the local coordinate of the quad vertex [0,0] -> [1,1]
    vec2 pos = a_instancePos + (a_quadVertex * a_instanceSize);

    // 2. Apply camera transform
    vec3 transformed = u_transform * vec3(pos, 1.0);

    // 3. Convert from logical pixels to clip space [-1, 1]
    vec2 clipSpace = (transformed.xy / u_resolution) * 2.0 - 1.0;
    
    // Invert Y axis because WebGL clip space has positive Y pointing UP, 
    // but our logical coordinates have positive Y pointing DOWN
    clipSpace.y = -clipSpace.y;

    gl_Position = vec4(clipSpace, 0.0, 1.0);

    // 4. Calculate UV coordinates for the fragment shader based on quad corner
    v_uv = mix(a_uvTopLeft, a_uvBottomRight, a_quadVertex);

    // 5. Pass per-instance color to fragment shader
    v_color = a_instanceColor;
}
