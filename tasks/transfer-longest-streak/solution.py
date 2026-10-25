def longest_streak(days):
    """days is a list of True/False values (True means practised that day).
    Return the length of the longest run of consecutive True values."""
    best = 0
    current = 0
    for practised in days:
        if practised:
            current += 1
        else:
            best = max(best, current)
            current = 0
    return max(best, current)


if __name__ == "__main__":
    print(longest_streak([True, True, False, True]))
    print(longest_streak([False, True, True, True]))
