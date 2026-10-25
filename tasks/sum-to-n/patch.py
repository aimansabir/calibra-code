def sum_to_n(n):
    """Return 1 + 2 + ... + n, or 0 when n is 0 or negative."""
    total = 0
    for i in range(1, n + 1):
        total += i
    return total


if __name__ == "__main__":
    print(sum_to_n(3))
    print(sum_to_n(5))
