{
  description = "A devShell with Zola for multiple systems";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            zola
            nixpkgs-fmt
            ripgrep
            wrangler
            nodePackages.prettier
          ];
        };
        devShells.screenshots = pkgs.mkShell {
          packages = with pkgs; [
            nodejs
            playwright-test
          ];
        };
      }
    );
}
