def count_vowels(text):
    count = 0
    for ch in text:
        if ch in "aeiou":
            count += 1
    return count


if __name__ == "__main__":
    print(count_vowels("banana"))
    print(count_vowels("APPLE"))
