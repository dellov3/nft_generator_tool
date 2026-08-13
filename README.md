# Studio Art Engine

### A visual NFT layer generator for building, previewing, and preparing generative NFT collections.

Studio Art Engine is a creator-focused NFT generation tool designed to make the process of building large generative collections simple, visual, and predictable.

Instead of managing layers, traits, rarity, rules, and metadata across multiple tools, Studio Art Engine brings the entire workflow into one interface.

> **Build your layers. Define your rules. Generate your collection.**

---

## Features

### Layer-Based NFT Generation

Build collections by combining multiple artwork layers such as:

* Background
* Body
* Clothing
* Eyes
* Accessories
* Special traits

Upload your artwork, organize layers, and define exactly how they should interact during generation.

### Rarity Control

Control the probability of individual traits and create the rarity distribution you want.

The app calculates rarity automatically based on trait frequency and provides rarity ranking across the generated collection.

### Rules Engine

Create rules to control which traits can or cannot appear together.

For example:

```text
Hat: Golden
+
Eyes: Laser

→ Allowed
```

or:

```text
Hat: Golden
+
Eyes: Red

→ Excluded
```

This helps prevent unwanted combinations while generating large collections.

### Genesis Craft & 1-of-1 NFTs

Create special NFTs manually using your existing traits or create unique 1-of-1 artwork.

1-of-1 NFTs can be incorporated into the collection while maintaining their individual identity and rarity.

### Collection Preview

Preview your collection before committing to the final generation.

Use random generation and visual previews to quickly identify:

* Unexpected combinations
* Incorrect layer ordering
* Unwanted trait combinations
* Rarity distribution issues

### Vault

The Vault provides a complete view of the generated collection.

Features include:

* Compact and Grid views
* Trait filtering
* Multi-trait filtering
* Search by NFT name or edition
* Rarity sorting
* NFT detail view

The filtering system is designed for large generative collections while keeping the interface fast and responsive.

### Metadata

Generate NFT metadata according to the blockchain standard selected for the collection.

Current target standards include:

* Ethereum
* Solana
* Internet Computer (ICP)

Additional blockchain standards can be added through the metadata architecture.

### Project Settings

Configure project-level information and generation settings, including:

* Project name
* Collection information
* NFT dimensions
* Supply
* Metadata configuration
* Blockchain target

---

## Workflow

The typical workflow looks like this:

```text
Create Project
      ↓
Upload Artwork
      ↓
Organize Layers
      ↓
Configure Rarity
      ↓
Create Rules
      ↓
Preview Collection
      ↓
Generate NFTs
      ↓
Review in Vault
      ↓
Generate Metadata
      ↓
Export Collection
```

The goal is to keep the entire process visual and easy to understand without requiring users to manually manage hundreds or thousands of files.

---

## Local-First Storage

Studio Art Engine currently works without a login system.

Project data and uploaded artwork are stored directly in the user's browser.

This keeps the application simple and avoids requiring an account or backend database just to create a collection.

For production workflows, users should export their finished collection and keep a separate backup.

---

## IPFS

IPFS integration is part of the project's deployment workflow.

The planned workflow is:

```text
Generated Collection
        ↓
Images + Metadata
        ↓
IPFS Upload
        ↓
CID
        ↓
Base URI / Token URI
        ↓
Ready for Marketplace Listing
```

The application is designed to eventually automate the preparation of a complete collection for IPFS-based NFT deployment and marketplace listing.

---

## Future: On-Chain Storage

One of the long-term goals of Studio Art Engine is deeper integration with the **Internet Computer (ICP)**.

The future direction is to support storing NFT artwork and metadata directly on-chain rather than relying exclusively on external storage such as IPFS.

This would allow creators to build collections with truly on-chain assets while keeping the same visual generation workflow.

---

## Design Philosophy

Studio Art Engine follows a simple design philosophy:

**Minimal. Visual. Fast. Predictable.**

The interface is designed around:

* Clear visual hierarchy
* Minimal UI
* Consistent spacing
* Smooth interactions
* Responsive feedback
* Reduced unnecessary complexity

The goal is to make a technically complex NFT generation workflow feel as simple as using a creative design tool.

---

## Technology

The project currently uses a modern web application stack including:

* React
* TypeScript
* Tailwind CSS
* Vite
* Internet Computer / Caffeine infrastructure
* Canvas-based image composition

The repository also includes configuration for ICP/Caffeine deployment and project tooling.

---

## Development

Clone the repository:

```bash
git clone https://github.com/dellov3/nft_generator_tool.git
cd nft_generator_tool
```

Install dependencies:

```bash
pnpm install
```

Run the development environment according to the project's configured scripts.

For containerized deployment:

```bash
docker build -t studio-art-engine .
docker run -it --network host studio-art-engine
```

---

## Project Status

Studio Art Engine is currently under active development.

The core NFT generation workflow is being continuously improved, including:

* Generation performance
* Rarity calculation
* Trait filtering
* Metadata generation
* Storage
* Export workflows
* UI/UX
* Blockchain compatibility

Some features may change as the project evolves.

---

## Roadmap

### Current

* [x] Layer-based NFT generation
* [x] Trait management
* [x] Rarity configuration
* [x] Generation rules
* [x] Collection preview
* [x] 1-of-1 / Forge workflow
* [x] Vault collection viewer
* [x] Trait filtering
* [x] Rarity ranking
* [x] Metadata generation
* [x] Multi-chain metadata architecture

### Next

* [ ] Improved collection export
* [ ] Production-ready IPFS workflow
* [ ] Automated marketplace preparation
* [ ] Additional blockchain metadata standards
* [ ] Improved large-collection performance
* [ ] On-chain storage on ICP
* [ ] More advanced collection validation

---

## Contributing

Contributions, ideas, bug reports, and feedback are welcome.

If you find a problem or have an idea that could improve Studio Art Engine, feel free to open an issue or submit a pull request.

---

## License

This project is released under the MIT License.

See [LICENSE](LICENSE) for details.

---

## Links

**GitHub**

https://github.com/dellov3/nft_generator_tool

---

### Studio Art Engine

**A cleaner way to create generative NFT collections.**

Build the layers.
Control the rarity.
Define the rules.
Generate the collection.
## 

To run app build and run docker image: `docker build -t app . docker run -it --network host app`
