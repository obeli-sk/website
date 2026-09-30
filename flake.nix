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
        # Include fontconfig's default rules so generic families (sans-serif, monospace)
        # resolve to DejaVu Sans and Sans Mono instead of the first font found.
        screenshotFonts = pkgs.writeText "fonts.conf" ''
          <?xml version="1.0"?>
          <!DOCTYPE fontconfig SYSTEM "fonts.dtd">
          <fontconfig>
            <dir>${pkgs.dejavu_fonts}</dir>
            <include ignore_missing="yes">${pkgs.fontconfig.out}/etc/fonts/conf.d</include>
          </fontconfig>
        '';
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
