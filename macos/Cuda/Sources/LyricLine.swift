import Foundation

struct LyricLine: Identifiable {
    let id: Int
    var time: Double?
    var text: String
    static func parse(_ text: String) -> [LyricLine] {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
        let pattern = try! NSRegularExpression(pattern: #"\[(\d+):(\d+(?:\.\d+)?)\]"#)
        var lines: [LyricLine] = []
        for raw in text.components(separatedBy: .newlines) {
            let string = raw as NSString, matches = pattern.matches(in: raw, range: NSRange(location: 0, length: string.length))
            if matches.isEmpty {
                if raw.range(of: #"^\[(ar|ti|al|by|offset):"#, options: .regularExpression) == nil { lines.append(LyricLine(id: lines.count, text: raw)) }
            } else {
                let body = pattern.stringByReplacingMatches(in: raw, range: NSRange(location: 0, length: string.length), withTemplate: "").trimmingCharacters(in: .whitespaces)
                for match in matches { let minute = Double(string.substring(with: match.range(at: 1))) ?? 0, second = Double(string.substring(with: match.range(at: 2))) ?? 0; lines.append(LyricLine(id: lines.count, time: minute * 60 + second, text: body)) }
            }
        }
        if lines.contains(where: { $0.time != nil }) { lines = lines.filter { $0.time != nil }.sorted { ($0.time ?? 0) < ($1.time ?? 0) } }
        return lines
    }
}
