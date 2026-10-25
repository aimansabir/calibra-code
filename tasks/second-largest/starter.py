def second_largest(numbers):
    """Return the second largest distinct value, or None if there isn't one."""
    ordered = sorted(numbers)
    return ordered[-2]


if __name__ == "__main__":
    print(second_largest([3, 1, 4, 2]))
    print(second_largest([10, 20]))
