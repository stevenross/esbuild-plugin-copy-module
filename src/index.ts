import resolve from 'resolve';
import path from 'path';
import fs from 'fs-extra';
import escapeStringRegexp from 'escape-string-regexp';
import { Plugin } from 'esbuild';

const resolvePromisfied = async (
  id: string,
  opts: resolve.AsyncOpts
): Promise<string | undefined> =>
  new Promise((resolvePromise, rejectPromise) => {
    resolve(id, opts, (err, resolved) => {
      err ? rejectPromise(err) : resolvePromise(resolved);
    });
  });

const base = path.dirname(process.argv[1]);

const nodeModuleCopyOnBundlePlugin = (modules: string[]): Plugin => ({
  name: 'esbuild-plugin-copy-module-on-bundle',
  setup(build) {
    const opts = build.initialOptions;

    if (
      !opts.bundle ||
      !(opts.outdir || opts.outfile) ||
      opts.platform !== 'node'
    )
      return;

    const dir = opts.outfile ? path.dirname(opts.outfile) : opts.outdir;

    if (!dir) return;

    build.onResolve(
      {
        filter: new RegExp(modules.map(escapeStringRegexp).join('|')),
      },
      async (args) => {
        const seen: string[] = [];

        const onResolve = async (pkgName: string, basedir: string) => {
          const resolved = await resolvePromisfied(pkgName, {
            basedir,
            includeCoreModules: false,
            readPackage: async (readFile, pkgfile, cb) => {
              readFile(pkgfile, async (err, data) => {
                if (err) {
                  cb(err);
                  console.error(err);
                  return;
                }

                if (!data) return;

                const packageJson = JSON.parse(data.toString());

                // overwrite package main field to point to itself so we can
                // simply use dirname on the resolved path later to get the
                // modules root directory
                packageJson.main = './package.json';

                const dependencies = Object.keys(
                  packageJson.dependencies || {}
                );

                await Promise.all(
                  dependencies.map((x) =>
                    onResolve(x, path.dirname(pkgfile)).catch(console.error)
                  )
                );

                cb(err, packageJson);
              });
            },
          });

          if (!resolved || resolved.includes(basedir) || seen.includes(pkgName))
            return;

          seen.push(pkgName);

          const from = path.dirname(resolved);
          const to = path.join(base, dir, 'node_modules', pkgName);

          await fs.copy(from, to, {
            dereference: true,
            overwrite: true,
          });

          return;
        };

        await onResolve(args.path, args.resolveDir);

        return {
          path: args.path,
          external: true,
        };
      }
    );
  },
});

export default nodeModuleCopyOnBundlePlugin;
