#version 300 es
precision highp float;

in vec2 v_uv;
in vec3 v_color;
out vec4 outColor;

uniform sampler2D u_msdfAtlas;

// Median of 3 values function for MSDF
float median(float r, float g, float b) {
    return max(min(r, g), min(max(r, g), b));
}

void main() {
    // Sample the MSDF texture directly (UVs are already correct)
    vec3 msd = texture(u_msdfAtlas, v_uv).rgb;
    
    // Standard MSDF: compute signed distance via median of the three channels
    // > 0.5 = inside glyph, < 0.5 = outside glyph
    float sd = median(msd.r, msd.g, msd.b);
    
    // Compute screen-space anti-aliasing width using UV derivatives
    // unitRange maps the fieldRange (4 texels) to normalized UV space
    vec2 unitRange = vec2(4.0) / vec2(textureSize(u_msdfAtlas, 0));
    vec2 screenTexSize = vec2(1.0) / fwidth(v_uv);
    float screenPxRange = max(0.5 * dot(unitRange, screenTexSize), 1.0);
    
    // Map the signed distance to screen pixels
    float screenPxDistance = screenPxRange * (sd - 0.5);
    
    // Anti-aliased alpha
    float alpha = clamp(screenPxDistance + 0.5, 0.0, 1.0);
    
    if (alpha <= 0.01) {
        discard;
    }

    // Output the final mapped color (premultiplied alpha) using per-instance color
    outColor = vec4(v_color * alpha, alpha);
}
