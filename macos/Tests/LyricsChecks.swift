import Foundation
@main struct LyricsChecks {
    static func main() {
        precondition(LyricLine.parse("").isEmpty)
        precondition(LyricLine.parse("  \n\t").isEmpty)
        let lines = LyricLine.parse("[ar:Cuda Sessions]\n[00:05.10][00:01.00]Sävel 🎵\n[00:09.00]Another fixture")
        precondition(lines.count == 3)
        precondition(lines.map { $0.time! } == [1, 5.1, 9])
        precondition(lines[0].text == "Sävel 🎵")
        precondition(Set(lines.map(\.id)).count == 3)
        let plain = LyricLine.parse("[Verse 1]\nOriginal fixture\n\nLast line")
        precondition(plain.count == 4 && plain.allSatisfy { $0.time == nil })
        print("PASS: synced timestamps, repeated lines, Unicode, metadata exclusion and plain lyrics")
    }
}
