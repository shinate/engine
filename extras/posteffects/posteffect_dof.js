//--------------- POST EFFECT DEFINITION------------------------//
pc.extend(pc.posteffect, function () {

    var Dof = function (graphicsDevice) {
        this.needsDepthBuffer = true;

        var attributes = {
            aPosition: pc.gfx.SEMANTIC_POSITION
        };

        var passThroughVert = [
            "attribute vec2 aPosition;",
            "",
            "varying vec2 vUv0;",
            "",
            "void main(void)",
            "{",
            "    gl_Position = vec4(aPosition, 0.0, 1.0);",
            "    vUv0 = (aPosition + 1.0) * 0.5;",
            "}"
        ].join("\n");

        var computeDepthBlur = [
            "precision " + graphicsDevice.precision + " float;",
            "",
            "uniform sampler2D uColorBuffer;",
            "uniform sampler2D uDepthBuffer;",
            "uniform float uFocus;",
            "uniform float uNear;",
            "uniform float uFar;",
            "uniform float uClampFar;",
            "",
            "varying vec2 vUv0;",
            "",
            pc.gfx.programlib.getSnippet(graphicsDevice, 'common_unpack_float'),
            "void main() {",
                "float f;",
                "vec4 packedDepth = texture2D(uDepthBuffer, vUv0);",
                "float depth = unpackFloat(packedDepth);",
                //"depth = (1.0 - depth);",
                "if (depth < uFocus)",
                "{",
                // scale depth value between near blur distance
                // and focal distance to [-1, 0] range
                "   f = (depth - uFocus) / (uFocus - uNear);",
                "}",
                "else",
                "{",
                // scale depth value between focal distance and far
                // blur distance to [0, 1] range
                "   f = (depth - uFocus) / (uFar - uFocus);",
                // clamp the far blur to a max bluriness
                "   f = clamp(f, 0.0, uClampFar);",
                "}",
                "",
                // scale and bias into [0, 1] range
                "f = f * 0.5 + 0.5;",
                "",
                "gl_FragColor = vec4(texture2D(uColorBuffer, vUv0).rgb,f);",
            "}"
        ].join("\n");

        // Pixel shader applies a one dimensional gaussian blur filter.
        // This is used twice by the bloom postprocess, first to
        // blur horizontally, and then again to blur vertically.
        var blurXFrag = [
            "precision " + graphicsDevice.precision + " float;",
            "varying vec2 vUv0;",
            "uniform float uBlur;",
            "uniform sampler2D uColorBuffer;",
            "",
            "void main(void) {",
            "   vec4 sum = vec4(0.0);",
            "",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x - 4.0 * uBlur, vUv0.y)) * 0.05;",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x - 3.0 * uBlur, vUv0.y)) * 0.09;",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x - 2.0 * uBlur, vUv0.y)) * 0.12;",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x - uBlur, vUv0.y)) * 0.15;",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x, vUv0.y)) * 0.16;",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x + uBlur, vUv0.y)) * 0.15;",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x + 2.0 * uBlur, vUv0.y)) * 0.12;",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x + 3.0 * uBlur, vUv0.y)) * 0.09;",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x + 4.0 * uBlur, vUv0.y)) * 0.05;",
            "",
            "   gl_FragColor = sum;",
            "}"
        ].join("\n");

        var blurYFrag = [
            "precision " + graphicsDevice.precision + " float;",
            "varying vec2 vUv0;",
            "uniform float uBlur;",
            "uniform sampler2D uColorBuffer;",
            "",
            "void main(void) {",
            "   vec4 sum = vec4(0.0);",
            "",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x, vUv0.y - 4.0 * uBlur)) * 0.05;",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x, vUv0.y - 3.0 * uBlur)) * 0.09;",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x, vUv0.y - 2.0 * uBlur)) * 0.12;",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x, vUv0.y - uBlur)) * 0.15;",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x, vUv0.y)) * 0.16;",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x, vUv0.y + uBlur)) * 0.15;",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x, vUv0.y + 2.0 * uBlur)) * 0.12;",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x, vUv0.y + 3.0 * uBlur)) * 0.09;",
            "   sum += texture2D(uColorBuffer, vec2(vUv0.x, vUv0.y + 4.0 * uBlur)) * 0.05;",
            "",
            "   gl_FragColor = sum;",
            "}"
        ].join("\n");

        var dofFrag = [
            "precision " + graphicsDevice.precision + " float;",
            "varying vec2 vUv0;",
            "uniform sampler2D uColorBuffer;",
            "uniform sampler2D uColorBufferBlurred;",
            "uniform vec2 uPixelSizeHigh;",
            "uniform vec2 uPixelSizeLow;",
            "",
            "void main(void) {",
            // maximum CoC radius and diameter in pixels
            "   vec2 maxCoc = vec2(5.0, 10.0);",
            // scale factor for max CoC size on low res
            "   float radiusScale = 0.4;",
            "   vec4 cOut = texture2D(uColorBuffer, vUv0);",
            "   float centerDepth = cOut.a;",
            "   float discRadius = abs(centerDepth * maxCoc.y - maxCoc.x);",
            "   float discRadiusLow = discRadius * radiusScale;",
            "   vec2 poisson[8];",
            "   poisson[0] = vec2(0.0, 0.0);",
            "   poisson[1] = vec2(0.527837, -0.085868);",
            "   poisson[2] = vec2(-0.040088, 0.536087);",
            "   poisson[3] = vec2(-0.670445, -0.179949);",
            "   poisson[4] = vec2(-0.419418, -0.616039);",
            "   poisson[5] = vec2(0.440453, -0.639399);",
            "   poisson[6] = vec2(-0.757088, 0.349334);",
            "   poisson[7] = vec2(0.574619, 0.685879);",
            "   cOut = vec4(0.0);",
            "   for (int t=0; t<8; t++) {",
            "      vec2 coordLow = vUv0 + (uPixelSizeLow * poisson[t] * discRadiusLow);",
            "      vec4 tapLow = texture2D(uColorBufferBlurred, coordLow);",
            "      vec2 coordHigh = vUv0 + (uPixelSizeHigh * poisson[t] * discRadius);",
            "      vec4 tapHigh = texture2D(uColorBuffer, coordHigh);",
            "      float tapBlur = abs(tapHigh.a * 2.0 - 1.0);",
            "      vec4 tap = mix(tapHigh, tapLow, tapBlur);",
            "      tap.a = (tap.a >= centerDepth) ? 1.0 : abs(tap.a * 2.0 - 1.0);",
            "      cOut.rgb += tap.rgb * tap.a;",
            "      cOut.a += tap.a;",
            "   }",
            "   gl_FragColor = cOut / cOut.a;",
            "}"
        ].join("\n");

        // Render targets
        var width = graphicsDevice.width;
        var height = graphicsDevice.height;
        this.targets = [
            this.createRenderTarget(graphicsDevice, width, height),
            // TODO: We should be downsamping the original image to 1/4 using a 4x4 box filter.
            this.createRenderTarget(graphicsDevice, width, height),
            this.createRenderTarget(graphicsDevice, width, height)
        ];

        // shaders
        this.blurXShader = new pc.gfx.Shader(graphicsDevice, {
            attributes: attributes,
            vshader: passThroughVert,
            fshader: blurXFrag
        });
        this.blurYShader = new pc.gfx.Shader(graphicsDevice, {
            attributes: attributes,
            vshader: passThroughVert,
            fshader: blurYFrag
        });

        this.shader = new pc.gfx.Shader(graphicsDevice, {
            attributes: attributes,
            vshader: passThroughVert,
            fshader: computeDepthBlur
        });


        this.dofShader = new pc.gfx.Shader(graphicsDevice, {
            attributes: attributes,
            vshader: passThroughVert,
            fshader: dofFrag
        });

        // Effect defaults

        this.blurAmount = 1/512;
        this.focus = 0.1;
        this.near = 9;
        this.far = 0.5;
        this.clampFar = 1;
        this.viewportSize = 997;
        this.blurAmount = 1/1280;

        this.pixelSize = [1/graphicsDevice.width, 1/graphicsDevice.height];
        this.pixelSizeLow = [1/graphicsDevice.width, 1/graphicsDevice.height];
    }

    Dof = pc.inherits(Dof, pc.posteffect.PostEffect);

    Dof.prototype = pc.extend(Dof.prototype, {

        createRenderTarget: function (graphicsDevice, width, height) {
            var colorBuffer = new pc.gfx.Texture(graphicsDevice, {
                format: pc.gfx.PIXELFORMAT_R8_G8_B8_A8,
                width: width,
                height: height
            });
            colorBuffer.minFilter = pc.gfx.FILTER_LINEAR;
            colorBuffer.magFilter = pc.gfx.FILTER_LINEAR;
            colorBuffer.addressU = pc.gfx.ADDRESS_CLAMP_TO_EDGE;
            colorBuffer.addressV = pc.gfx.ADDRESS_CLAMP_TO_EDGE;
            return new pc.gfx.RenderTarget(graphicsDevice, colorBuffer, { depth: false });
        },

        render: function (inputTarget, outputTarget, rect) {
            var device = this.device;
            var scope = device.scope;

            scope.resolve("uColorBuffer").setValue(inputTarget.colorBuffer);
            scope.resolve("uDepthBuffer").setValue(this.depthMap);
            scope.resolve("uFocus").setValue(this.focus);
            scope.resolve("uNear").setValue(this.near);
            scope.resolve("uFar").setValue(this.far);
            scope.resolve("uClampFar").setValue(this.clampFar);
            pc.posteffect.drawFullscreenQuad(device, this.targets[0], this.vertexBuffer, this.shader, rect);
            //pc.posteffect.drawFullscreenQuad(device, outputTarget, this.vertexBuffer, this.shader, rect);
            //return;

            // Pass 2: draw from rendertarget 1 into rendertarget 2,
            // using a shader to apply a horizontal gaussian blur filter.
            scope.resolve("uBlur").setValue(this.blurAmount);
            scope.resolve("uColorBuffer").setValue(this.targets[0].colorBuffer);
            pc.posteffect.drawFullscreenQuad(device, this.targets[1], this.vertexBuffer, this.blurXShader, rect);

            // Pass 3: draw from rendertarget 2 back into rendertarget 1,
            // using a shader to apply a vertical gaussian blur filter.
            scope.resolve("uColorBuffer").setValue(this.targets[1].colorBuffer);
            pc.posteffect.drawFullscreenQuad(device, this.targets[2], this.vertexBuffer, this.blurYShader, rect);

            // Pass 4: draw from rendertarget 2 back into rendertarget 1,
            // using a shader to apply a vertical gaussian blur filter.
            scope.resolve("uColorBuffer").setValue(this.targets[0].colorBuffer);
            scope.resolve("uColorBufferBlurred").setValue(this.targets[2].colorBuffer);
            scope.resolve("uPixelSizeHigh").setValue(this.pixelSize);
            scope.resolve("uPixelSizeLow").setValue(this.pixelSizeLow);
            pc.posteffect.drawFullscreenQuad(device, outputTarget, this.vertexBuffer, this.dofShader, rect);
        }
    });

    return {
        Dof: Dof
    };
}());

//--------------- SCRIPT ATTRIBUTES ------------------------//
pc.script.attribute('focus', 'number', 1, {
    min: 0,
    decimalPrecision: 5,
    step: 0.5
});

pc.script.attribute('near', 'number', 0, {
    min: 0,
    decimalPrecision: 5,
    step: 0.5
});

pc.script.attribute('far', 'number', 50, {
    min: 0,
    decimalPrecision: 5,
    step: 0.5
});

pc.script.attribute('clampFar', 'number', 1, {
    min: 0,
    max: 1,
    step: 0.01,
    decimalPrecision: 5
});


//--------------- SCRIPT DEFINITION------------------------//
pc.script.create('dof', function (context) {

    // Creates a new Dof instance
    var Dof = function (entity) {
        this.entity = entity;
        this.effect = new pc.posteffect.Dof(context.graphicsDevice);
    };

    Dof.prototype = {
        initialize:  function () {
            this.on('set', this.onAttributeChanged, this);
            this.entity.camera.on('set_nearClip', this.reset, this);
            this.entity.camera.on('set_farClip', this.reset, this);
            this.reset();
        },

        reset: function () {
            this.effect.focus = this.makePercentage(this.focus);
            this.effect.near = this.makePercentage(this.near);
            this.effect.far = this.makePercentage(this.far);
            this.effect.clampFar = this.clampFar;
        },

        makePercentage: function (value) {
            var result = (value - this.entity.camera.nearClip) / (this.entity.camera.farClip - this.entity.camera.nearClip);
            return pc.math.clamp(result, 0, 1);
        },

        onAttributeChanged: function (name, oldValue, newValue) {
            if (name != 'clampFar') {
                newValue = this.makePercentage(newValue);
            }

            this.effect[name] = newValue;
        },

        onEnable: function () {
            this.entity.camera.postEffects.addEffect(this.effect, false);
        },

        onDisable: function () {
            this.entity.camera.postEffects.removeEffect(this.effect);
        }
    };

    return Dof;

});