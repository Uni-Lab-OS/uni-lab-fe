/**
 * This file can be edited to adjust the ESBuild build process.
 * To reset, delete this file and rerun theia build again.
 */
import { browserOptions, mode, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';

import esbuild from 'esbuild';
import { copy } from 'esbuild-plugin-copy';
import { sassPlugin } from 'esbuild-sass-plugin';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { injectWorkbenchPreloadShell } from './scripts/preload-shell.mjs';
import { copyWorkbenchDracoAssets } from './scripts/draco-assets.mjs';

const sharedShimPath = name => fileURLToPath(
    new URL(`../../packages/pascal-host/src/shims/${name}.tsx`, import.meta.url)
);

browserOptions.alias = {
    ...browserOptions.alias,
    'next/image': sharedShimPath('next-image'),
    'next/link': sharedShimPath('next-link'),
};
browserOptions.jsx = 'automatic';
// Theia emits an IIFE bundle, so native `import.meta.url` has no module URL.
// Pascal's Three.js KTX2 loader still constructs its fallback URLs eagerly;
// the actual transcoder path is configured separately, but the base must be
// valid while the module initializes.
browserOptions.define = {
    ...browserOptions.define,
    'import.meta.url': 'window.location.href',
    'process.env.NODE_ENV': JSON.stringify(mode),
    'process.env.NEXT_PUBLIC_ASSETS_CDN_URL': JSON.stringify(
        process.env.NEXT_PUBLIC_ASSETS_CDN_URL ?? ''
    ),
    'process.env': '{}',
};

browserOptions.plugins.unshift(
    sassPlugin({ filter: /\.module\.scss$/, type: 'local-css' }),
    sassPlugin({ filter: /\.scss$/, type: 'css' }),
);
browserOptions.plugins.push(
    copy({
        assets: [
            {
                from: fileURLToPath(new URL('../kernel-web/public/icons/*', import.meta.url)),
                to: fileURLToPath(new URL('./lib/frontend/icons', import.meta.url)),
            },
            {
                from: fileURLToPath(new URL('../kernel-web/public/cursor.svg', import.meta.url)),
                to: fileURLToPath(new URL('./lib/frontend', import.meta.url)),
            },
        ],
    }),
);
browserOptions.plugins.push({
    name: 'unilab-workbench-runtime-assets',
    setup(build) {
        build.onEnd(async result => {
            if (result.errors.length > 0) return;
            const indexPath = fileURLToPath(
                new URL('./lib/frontend/index.html', import.meta.url)
            );
            const source = await readFile(indexPath, 'utf8');
            const injected = injectWorkbenchPreloadShell(source);
            if (injected !== source) await writeFile(indexPath, injected);
            await copyWorkbenchDracoAssets();
        });
    },
});

// drivelist 12.0.2 does not publish a Windows N-API prebuild. Requiring its
// missing native binding would crash the complete Theia backend during boot,
// although Theia only needs mount points from it. Keep the native package on
// macOS/Linux and use a narrow, pure-Node drive-root provider on Windows.
if (process.platform === 'win32') {
    nodeOptions.alias = {
        ...nodeOptions.alias,
        drivelist: fileURLToPath(
            new URL('./scripts/drivelist-windows-shim.cjs', import.meta.url)
        ),
    };
}

const browserContext = await esbuild.context(browserOptions);
const nodeContext = await esbuild.context(nodeOptions);


if (watch) {
    await Promise.all([
        browserContext.watch(),
        nodeContext.watch(),
    ]);
} else {
    try {
        await browserContext.rebuild();
        await browserContext.dispose();
        await nodeContext.rebuild();
        await nodeContext.dispose();
    } catch {
        process.exit(1);
    }
}
