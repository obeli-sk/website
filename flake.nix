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
        screenshotFonts = pkgs.makeFontsConf {
          fontDirectories = [ pkgs.dejavu_fonts ];
        };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            zola
            nixpkgs-fmt
            ripgrep
            wrangler
            prettier
          ];
        };
        devShells.screenshots = pkgs.mkShell {
          packages = with pkgs; [
            nodejs
            playwright-test
          ];
          shellHook = ''
            export NODE_PATH=${pkgs.playwright-test}/lib/node_modules''${NODE_PATH:+:$NODE_PATH}
            export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}
            export FONTCONFIG_FILE=${screenshotFonts}
          '';
        };
      }
    );
}
