# svseeds - the SvSeeds CLI
A CLI to copy SvSeeds components for Svelte.

## Quick Start
```
npx svseeds
```

## Basic Usage
Copy specified SvSeeds files.
```
npx svseeds [components...]
```

## Main Options
- Specify directory:
```
npx svseeds -d <directory> [components...]
```

- Specify all components:
```
npx svseeds -a
```

- Update copied components:
```
npx svseeds -u [components...]
```

- Remove components:
```
npx svseeds -r [components...]
```
(Of course, the components are just a file, you can use `rm` command instead.)

- Run without interactions:
```
npx svseeds --no-confirm [components...]
```

## Other Options
- Remove all components:
```
npx svseeds --uninstall
```

- Copy without overwrite
```
npx svseeds --no-overwrite [components...]
```

- Copy without `_style.ts` file
```
npx svseeds --no-style [components...]
```
