def count_peaks(heights):
    """Count the positions that are strictly higher than both neighbours.
    The first and last positions only have one neighbour, so they never count."""
    peaks = 0
    for i in range(len(heights)):
        if heights[i] > heights[i - 1] and heights[i] > heights[i + 1]:
            peaks += 1
    return peaks


if __name__ == "__main__":
    print(count_peaks([1, 3, 2]))
    print(count_peaks([1, 2, 3]))
