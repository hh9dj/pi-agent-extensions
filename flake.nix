{
  description = "Pi extensions dev shell";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
    in
    {
      devShells.x86_64-linux.default = pkgs.mkShell {
        packages = [
          pkgs.nodejs
          pkgs.typescript-go
        ];
        shellHook = ''
          test -d node_modules || npm install
        '';
      };
    };
}
