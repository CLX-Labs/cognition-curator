import Foundation

// Helper for [String: Any] Transformable
struct CodableDictionary: Codable {
    let dictionary: [String: AnyCodable]
}

// Helper for [String] Transformable
struct CodableArray: Codable {
    let array: [String]
}

// Custom Codable wrapper for Any to allow [String: Any] to be Codable
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map { $0.value }
        } else if let dictionary = try? container.decode([String: AnyCodable].self) {
            value = dictionary.mapValues { $0.value }
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "AnyCodable cannot decode value")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let int = value as? Int {
            try container.encode(int)
        } else if let double = value as? Double {
            try container.encode(double)
        } else if let bool = value as? Bool {
            try container.encode(bool)
        } else if let string = value as? String {
            try container.encode(string)
        } else if let array = value as? [Any] {
            try container.encode(array.map(AnyCodable.init))
        } else if let dictionary = value as? [String: Any] {
            try container.encode(dictionary.mapValues(AnyCodable.init))
        } else {
            let context = EncodingError.Context(codingPath: container.codingPath, debugDescription: "AnyCodable cannot encode value")
            throw EncodingError.invalidValue(value, context)
        }
    }
}

struct CodableStringArray: Codable {
    var values: [String]
    
    init(_ values: [String]) {
        self.values = values
    }
}

struct CodableStringDictionary: Codable {
    var values: [String: String]
    
    init(_ values: [String: Any]) {
        self.values = values.reduce(into: [String: String]()) { result, pair in
            if let stringValue = pair.value as? String {
                result[pair.key] = stringValue
            } else {
                result[pair.key] = String(describing: pair.value)
            }
        }
    }
    
    func toDictionary() -> [String: Any] {
        return values as [String: Any]
    }
}

