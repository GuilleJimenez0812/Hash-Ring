module.exports = {
  branches: ["main", {name: "next", prerelease: true}, { name: "v*", tagFormat: "v${version}" }],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/npm",
    "@semantic-release/github"
  ]
}