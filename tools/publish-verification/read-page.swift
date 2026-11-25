import AppKit
import ApplicationServices

struct Query: Decodable {
    let platform: String
    let accountId: String
    let brand: String
    let titles: [String]
    let caption: String?
    let images: Int?
}

struct Observation: Encodable {
    let title: String
    let status: String
    let date: String?
    let contentId: String?
    let fields: [String]
    let matchedBy: String
}

struct Result: Encodable {
    let code: String
    var observations: [Observation] = []
    var inspected: Int = 0
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func string(_ element: AXUIElement, _ name: String) -> String {
    (attribute(element, name) as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
}

func element(_ owner: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = attribute(owner, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}

func children(_ element: AXUIElement) -> [AXUIElement] {
    attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
}

func find(_ root: AXUIElement, depth: Int, where matches: (AXUIElement) -> Bool) -> AXUIElement? {
    if matches(root) { return root }
    guard depth > 0 else { return nil }
    for child in children(root) {
        if let match = find(child, depth: depth - 1, where: matches) { return match }
    }
    return nil
}

func staticText(_ root: AXUIElement, depth: Int = 22, limit: Int = 4500) -> [(node: AXUIElement, text: String)] {
    var values: [(AXUIElement, String)] = []
    var pending = [(root, depth)]
    var inspected = 0
    while let (node, remaining) = pending.popLast(), inspected < limit {
        inspected += 1
        if string(node, kAXRoleAttribute) == "AXStaticText" {
            let text = string(node, kAXValueAttribute)
            if !text.isEmpty { values.append((node, text)) }
        } else if remaining > 0 {
            pending.append(contentsOf: children(node).reversed().map { ($0, remaining - 1) })
        }
    }
    return values
}

func named(_ root: AXUIElement, role: String, title: String) -> AXUIElement? {
    find(root, depth: 16) {
        string($0, kAXRoleAttribute) == role && string($0, kAXTitleAttribute) == title
    }
}

func press(_ node: AXUIElement) -> Bool {
    AXUIElementPerformAction(node, kAXPressAction as CFString) == .success
}

func until<T>(_ seconds: TimeInterval, _ read: () -> T?) -> T? {
    let end = Date().addingTimeInterval(seconds)
    repeat {
        if let result = read() { return result }
        Thread.sleep(forTimeInterval: 0.22)
    } while Date() < end
    return nil
}

func fold(_ string: String) -> String {
    string.precomposedStringWithCompatibilityMapping
        .replacingOccurrences(of: "[\\s\\u200B\\uFEFF]", with: "", options: .regularExpression)
}

let punctuation = CharacterSet(charactersIn: "。！!？?")
func sameTitle(_ title: String, _ target: String, withCaption: Bool) -> Bool {
    let normalized = fold(title)
    let expected = target.trimmingCharacters(in: punctuation)
    guard !expected.isEmpty else { return false }
    if normalized.trimmingCharacters(in: punctuation) == expected { return true }
    guard withCaption, normalized.hasPrefix(expected) else { return false }
    let rest = normalized.dropFirst(expected.count)
    return rest.first.map { "。!?！？#".contains($0) } ?? false
}

func captionText(_ text: String) -> String {
    fold(text).lowercased().replacingOccurrences(of: #"\p{P}+"#, with: "", options: .regularExpression)
}

func sameCaption(_ visible: String, _ caption: String) -> Bool {
    let observed = captionText(visible)
    let expected = captionText(caption)
    guard min(observed.count, expected.count) >= 32 else { return false }
    if observed.hasPrefix(expected) || expected.hasPrefix(observed) { return true }

    let fragments = caption.components(separatedBy: CharacterSet(charactersIn: "。！!？?\n"))
        .map(captionText).filter { $0.count >= 18 }
    var remaining = observed[...]
    var found = Set<String>()
    for fragment in fragments {
        let anchor = String(fragment.prefix(28))
        if !found.contains(anchor), let range = remaining.range(of: anchor) {
            found.insert(anchor)
            if found.count >= 2 { return true }
            remaining = remaining[range.upperBound...]
        }
    }
    return false
}

let datePattern = #"^(?:[0-9]{4}[年/-])?[0-9]{1,2}[月/-][0-9]{1,2}日?(?:\s+[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)?$"#
let statuses: Set<String> = ["已发布", "已发表", "定时发布", "待审核", "审核中", "发布中"]
let primaryLabels: Set<String> = ["播放", "阅读", "阅读量"]

func card(_ node: AXUIElement, title: String, wechat: Bool, matchedBy: String) -> Observation? {
    var current = element(node, kAXParentAttribute)
    var articleFields: [String]?
    var identifier: String?
    if wechat {
        guard let link = current, string(link, kAXRoleAttribute) == "AXLink",
              let url = attribute(link, kAXURLAttribute) as? URL, url.scheme == "https",
              url.host == "mp.weixin.qq.com", url.path == "/s" || url.path.hasPrefix("/s/") else { return nil }
        if url.path.hasPrefix("/s/") { identifier = url.lastPathComponent }
        if let parent = element(link, kAXParentAttribute) {
            articleFields = staticText(parent, depth: 8, limit: 120).map(\.text)
        }
    }
    for _ in 0..<7 {
        guard let ancestor = current, string(ancestor, kAXRoleAttribute) != "AXWebArea" else { return nil }
        let texts = staticText(ancestor, depth: 12, limit: 450).map(\.text)
        let states = texts.filter(statuses.contains)
        if states.count > 1 { return nil }
        let dates = texts.filter { $0.range(of: datePattern, options: .regularExpression) != nil }
        if let state = states.first, let date = dates.first, dates.count == 1,
           wechat || !primaryLabels.isDisjoint(with: texts) || texts.contains("编辑作品") {
            return Observation(title: title, status: state, date: date, contentId: identifier, fields: articleFields ?? texts, matchedBy: matchedBy)
        }
        current = element(ancestor, kAXParentAttribute)
    }
    return nil
}

func read(_ query: Query) -> Result {
    let wechat = query.platform == "wechat"
    guard wechat || query.platform == "douyin" else { return Result(code: "unsupported") }
    guard AXIsProcessTrusted() else { return Result(code: "permission") }
    let host = wechat ? "mp.weixin.qq.com" : "creator.douyin.com"
    let listPath = wechat ? "/cgi-bin/appmsgpublish" : "/creator-micro/content/manage"
    guard let process = NSRunningApplication.runningApplications(withBundleIdentifier: "com.google.Chrome")
        .first(where: { $0.activationPolicy == .regular }) else { return Result(code: "closed") }
    let app = AXUIElementCreateApplication(process.processIdentifier)
    AXUIElementSetMessagingTimeout(app, 0.8)
    func page() -> (AXUIElement, String)? {
        guard let window = element(app, kAXFocusedWindowAttribute),
              let web = find(window, depth: 13, where: { string($0, kAXRoleAttribute) == "AXWebArea" }),
              let url = attribute(web, kAXURLAttribute) as? URL, url.scheme == "https", url.host == host else { return nil }
        return (web, url.path)
    }

    let identity = until(12) { () -> Result? in
        guard let (web, path) = page() else { return nil }
        let labels = staticText(web, depth: 13, limit: 500).map(\.text)
        if labels.contains(where: { ["扫码登录", "手机号登录", "短信验证码登录", "微信扫码登录"].contains($0) }) {
            return Result(code: "login")
        }
        if wechat {
            guard let menu = named(web, role: "AXLink", title: "发表记录") else { return nil }
            guard labels.contains(query.brand) else { return Result(code: "account") }
            return Result(code: path == listPath || press(menu) ? "ok" : "navigation")
        }
        guard let account = labels.firstIndex(where: { fold($0).trimmingCharacters(in: CharacterSet(charactersIn: ":")) == "抖音号" }),
              account + 1 < labels.count else { return nil }
        guard labels[account + 1] == query.accountId else { return Result(code: "account") }
        guard let menu = named(web, role: "AXMenuItem", title: "内容管理") else { return nil }
        return Result(code: path == listPath || press(menu) ? "ok" : "navigation")
    }
    guard identity?.code == "ok" else { return identity ?? Result(code: "identity") }

    let targets = query.titles.map(fold)
    var visited = Set<String>()
    var inspected = 0
    var previousSize = 0
    for pass in 0..<8 {
        let list = until(pass == 0 ? 9 : 2.5) { () -> (AXUIElement, [(node: AXUIElement, text: String)], String)? in
            guard let (web, path) = page(), path == listPath else { return nil }
            let texts = staticText(web)
            let labels = texts.map(\.text)
            let marks = labels.filter { $0.range(of: datePattern, options: .regularExpression) != nil }
            let count = labels.filter(statuses.contains).count
            let key = marks.joined(separator: "|") + ":" + String(count)
            guard !visited.contains(key), count > 0 || labels.contains(where: { ["暂无作品", "暂无发表记录", "暂无内容", "未发表过内容"].contains($0) }) else { return nil }
            return (web, texts, key)
        }
        guard let (web, texts, key) = list else { break }
        if wechat, !texts.contains(where: { $0.text == query.brand }) { return Result(code: "account") }
        visited.insert(key)
        let found = texts.compactMap { item in
            if targets.contains(where: { sameTitle(item.text, $0, withCaption: !wechat) }) {
                return card(item.node, title: item.text, wechat: wechat, matchedBy: "title")
            }
            guard !wechat, let caption = query.caption, sameCaption(item.text, caption),
                  let candidate = card(item.node, title: item.text, wechat: false, matchedBy: "caption") else { return nil }
            if let expected = query.images,
               let count = candidate.fields.first(where: { $0.range(of: #"^[0-9]+\s*张图$"#, options: .regularExpression) != nil }),
               Int(count.prefix(while: \.isNumber)) != expected { return nil }
            return candidate
        }
        let markers = texts.filter { statuses.contains($0.text) }
        inspected += wechat ? markers.count : max(0, markers.count - previousSize)
        previousSize = markers.count
        if !found.isEmpty { return Result(code: "matched", observations: found, inspected: inspected) }

        if wechat {
            guard let next = named(web, role: "AXLink", title: "下一页"),
                  attribute(next, kAXEnabledAttribute) as? Bool != false, press(next) else { break }
        } else {
            guard let tail = texts.last(where: { $0.text == "加载中…" })?.node ?? markers.last?.node,
                  AXUIElementPerformAction(tail, "AXScrollToVisible" as CFString) == .success else { break }
        }
    }
    return Result(code: visited.isEmpty ? "list" : "not_visible", inspected: inspected)
}

do {
    let query = try JSONDecoder().decode(Query.self, from: FileHandle.standardInput.readDataToEndOfFile())
    FileHandle.standardOutput.write(try JSONEncoder().encode(read(query)))
} catch {
    FileHandle.standardOutput.write(Data("{\"code\":\"invalid\"}".utf8))
}
