import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: Process?
    private var logHandle: FileHandle?
    private var stopping = false
    private let origin = URL(string: "http://127.0.0.1:8000/")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildWindow()
        window.center()
        window.setFrameAutosaveName("LogbookMain")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        DispatchQueue.global(qos: .userInitiated).async {
            self.prepareServer()
            self.waitUntilReady(attempt: 0)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        stopping = true
        server?.interrupt()
    }

    private func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Logbook"
        window.minSize = NSSize(width: 880, height: 640)
        window.backgroundColor = NSColor(srgbRed: 0.965, green: 0.961, blue: 0.941, alpha: 1)
        showMessage("Startar Logbook…")

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: window.contentView?.bounds ?? .zero, configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
    }

    private func projectRoot() -> String? {
        Bundle.main.object(forInfoDictionaryKey: "LogbookRoot") as? String
    }

    private func prepareServer() {
        guard !healthy() else { return }
        guard let root = projectRoot() else {
            DispatchQueue.main.async { self.showMessage("Sökvägen till Logbook saknas.") }
            return
        }
        let python = (root as NSString).appendingPathComponent(".venv/bin/python")
        guard FileManager.default.isExecutableFile(atPath: python) else {
            DispatchQueue.main.async { self.showMessage("Python-miljön saknas. Kör installationen i projektmappen igen.") }
            return
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: python)
        process.arguments = ["-m", "uvicorn", "backend.app:app", "--host", "127.0.0.1", "--port", "8000"]
        process.currentDirectoryURL = URL(fileURLWithPath: root)
        process.terminationHandler = { [weak self] proc in
            guard let self, !self.stopping, proc.terminationStatus != 0 else { return }
            DispatchQueue.main.async {
                self.showMessage("Logbook-servern stannade. Se ~/Library/Logs/Logbook/server.log")
            }
        }

        let logURL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Logbook/server.log")
        do {
            try FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            if !FileManager.default.fileExists(atPath: logURL.path) {
                FileManager.default.createFile(atPath: logURL.path, contents: nil)
            }
            let handle = try FileHandle(forWritingTo: logURL)
            try handle.seekToEnd()
            logHandle = handle
            process.standardOutput = handle
            process.standardError = handle
            try process.run()
            server = process
        } catch {
            DispatchQueue.main.async { self.showMessage("Kunde inte starta Logbook.") }
        }
    }

    private func waitUntilReady(attempt: Int) {
        if healthy() {
            DispatchQueue.main.async {
                self.window.contentView = self.webView
                self.webView.frame = self.window.contentView?.bounds ?? self.webView.frame
                self.webView.load(URLRequest(url: self.origin))
            }
            return
        }
        if attempt >= 40 {
            DispatchQueue.main.async {
                self.showMessage("Logbook svarade inte. Se ~/Library/Logs/Logbook/server.log")
            }
            return
        }
        Thread.sleep(forTimeInterval: 0.25)
        waitUntilReady(attempt: attempt + 1)
    }

    private func healthy() -> Bool {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:8000/api/health")!)
        request.timeoutInterval = 1
        let semaphore = DispatchSemaphore(value: 0)
        var ok = false
        URLSession.shared.dataTask(with: request) { data, response, _ in
            defer { semaphore.signal() }
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  json["status"] as? String == "ok" else { return }
            ok = true
        }.resume()
        _ = semaphore.wait(timeout: .now() + 2)
        return ok
    }

    private func showMessage(_ text: String) {
        let container = NSView(frame: window.contentLayoutRect)
        container.autoresizingMask = [.width, .height]
        let label = NSTextField(wrappingLabelWithString: text)
        label.alignment = .center
        label.font = .systemFont(ofSize: 16)
        label.textColor = NSColor(srgbRed: 0.396, green: 0.463, blue: 0.357, alpha: 1)
        label.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            label.widthAnchor.constraint(lessThanOrEqualTo: container.widthAnchor, constant: -48),
        ])
        window.contentView = container
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        if isLocal(url) {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            NSWorkspace.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if isLocal(url) {
                webView.load(URLRequest(url: url))
            } else {
                NSWorkspace.shared.open(url)
            }
        }
        return nil
    }

    private func isLocal(_ url: URL) -> Bool {
        url.host == "127.0.0.1" || url.host == "localhost" || url.scheme == "about"
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
