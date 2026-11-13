# Editor++

**Collaborative level editor for Geometry Dash**, designed for up to four participants in online and local (LAN) sessions.

## Project goals

- Up to 4 people editing one level together.
- Online rooms and local-network rooms.
- Live synchronization of editor changes.
- Conflict handling and host-controlled permissions.
- Session recovery and safe saving.

## Development targets

- Geometry Dash: 2.2081
- Geode SDK: v5.11.2
- Android: ARM32 and ARM64
- Build system: CMake + GitHub Actions

## Current status

This repository starts with the Geode mod scaffold and build automation. The multiplayer transport and in-game editor integration are **not implemented yet**. They will be developed in small, testable stages.

## Architecture

- `src/core/`: shared application state and lifecycle.
- `src/collaboration/`: room, participant and synchronization logic.
- `src/network/`: transport abstractions for online and LAN.
- `src/ui/`: in-game interface.
- `src/editor/`: Geometry Dash editor integration.

## Build

Pushes and pull requests build Android32 and Android64 packages with GitHub Actions. Download the generated `.geode` files from the workflow run's Artifacts section.

See [Geode's documentation](https://docs.geode-sdk.org/) for SDK and mod development details.
