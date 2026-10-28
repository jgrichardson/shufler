# frozen_string_literal: true

# Homebrew formula for Shufler, for the tap github.com/jgrichardson/homebrew-shufler (as Formula/shufler.rb):
#
#   brew tap jgrichardson/shufler
#   brew install shufler
#
# packaging/release.sh writes a copy with the release's url and sha256 filled in (dist/shufler.rb); this file keeps
# placeholders. The url is the sdist attached to the GitHub release, which already holds the built web app, so
# installing needs neither Bun nor Node. The Python dependencies come from PyPI as wheels at install time; a
# formula bound for homebrew-core would pin each one as a `resource` instead (brew update-python-resources).
class Shufler < Formula
  desc "3D control room for developers who run many AI coding agent sessions at once"
  homepage "https://github.com/jgrichardson/shufler"
  url "https://github.com/jgrichardson/shufler/releases/download/v0.0.0/shufler-0.0.0.tar.gz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"

  depends_on "python@3.13"

  def install
    python = formula_opt_bin("python@3.13")/"python3.13"
    system python, "-m", "venv", libexec
    system libexec/"bin/python", "-m", "pip", "install", "--no-cache-dir", "--disable-pip-version-check", buildpath
    bin.install_symlink libexec/"bin/shufler"
  end

  def caveats
    <<~EOS
      Shufler reads pull requests through the GitHub CLI: brew install gh, then gh auth login.

      Pick your terminal (cmux, iTerm2 or tmux) and write ~/.config/shufler/config.toml:
        shufler setup
      Then start the daemon and open http://127.0.0.1:4700:
        shufler start
      Or run it at login with `brew services start shufler`. With cmux, start it from a shell inside a cmux
      workspace instead: cmux only accepts connections from processes it started.
    EOS
  end

  service do
    run [opt_bin/"shufler", "serve"]
    keep_alive true
    log_path var/"log/shufler.log"
    error_log_path var/"log/shufler.log"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/shufler version")
    assert_match "--terminal", shell_output("#{bin}/shufler setup --help")
  end
end
